"""Pull BTS on-time performance, IEM METAR and OpenFlights into data/raw/.

Skips what's already on disk, so re-running after an interrupted download
picks up where it left off.
"""
from __future__ import annotations

import argparse
import io
import shutil
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import AIRPORTS, RAW, YEAR  # noqa: E402

BTS_URL = (
    "https://transtats.bts.gov/PREZIP/"
    "On_Time_Reporting_Carrier_On_Time_Performance_1987_present_{year}_{month}.zip"
)
IEM_URL = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
OPENFLIGHTS_URL = (
    "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat"
)

# BTS 403s the default requests agent often enough to matter
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

# BTS gives ~400 KB/s per connection, so go wide. Keeping the counts modest --
# these are free public endpoints and it'd be rude to hammer them.
BTS_JOBS = 4
IEM_JOBS = 3

_print_lock = Lock()


def _say(message: str) -> None:
    with _print_lock:
        print(message, flush=True)


def _get(url: str, *, params: dict | None = None, timeout: int = 600, retries: int = 3):
    last = None
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=timeout)
            r.raise_for_status()
            return r
        except Exception as exc:  # noqa: BLE001 - network flakiness is the point
            last = exc
            wait = 5 * (attempt + 1)
            print(f"    retry {attempt + 1}/{retries} in {wait}s ({exc})")
            time.sleep(wait)
    raise RuntimeError(f"failed after {retries} attempts: {url}") from last


def _run_jobs(workers: int, jobs: dict) -> None:
    """Run downloads concurrently, printing each as it lands.

    One failure doesn't cancel the rest; the summary names what's still missing.
    """
    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fn, *args): key for key, (fn, args) in jobs.items()}
        for done in as_completed(futures):
            key = futures[done]
            try:
                _say(done.result())
            except Exception as exc:  # noqa: BLE001 - reported, not swallowed
                failures.append(f"{key}: {exc}")
                _say(f"  [FAIL] {key}: {exc}")
    if failures:
        _say(f"  {len(failures)} download(s) failed; re-run to retry them.")


def _fetch_bts_month(year: int, month: int, out_dir: Path) -> str:
    target = out_dir / f"bts_{year}_{month:02d}.csv"
    if target.exists() and target.stat().st_size > 0:
        return f"  [skip] {target.name}"

    r = _get(BTS_URL.format(year=year, month=month))
    # .part then rename, or an interrupted run leaves a truncated CSV that the
    # next run happily skips
    tmp = target.with_suffix(".csv.part")
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        with zf.open(name) as src, open(tmp, "wb") as dst:
            while chunk := src.read(1 << 20):
                dst.write(chunk)
    tmp.rename(target)
    return f"  [ok  ] {target.name} ({target.stat().st_size / 1e6:.0f} MB)"


def download_bts(year: int = YEAR) -> None:
    out_dir = RAW / "bts"
    out_dir.mkdir(parents=True, exist_ok=True)
    _run_jobs(
        BTS_JOBS,
        {month: (_fetch_bts_month, (year, month, out_dir)) for month in range(1, 13)},
    )


def _fetch_station(station: str, year: int, out_dir: Path) -> str:
    target = out_dir / f"{station}.csv"
    if target.exists() and target.stat().st_size > 1000:
        return f"  [skip] {station}"

    params = {
        "station": station,
        "data": ["tmpf", "sknt", "gust", "p01i", "vsby"],
        "year1": year, "month1": 1, "day1": 1,
        "year2": year + 1, "month2": 1, "day2": 1,
        "tz": "Etc/UTC",
        "format": "onlycomma",
        "latlon": "no",
        "missing": "M",
        "trace": "0.0001",
        "direct": "no",
        "report_type": [3, 4],  # routine + specials
    }
    r = _get(IEM_URL, params=params)
    tmp = target.with_suffix(".csv.part")
    tmp.write_bytes(r.content)
    tmp.rename(target)
    return f"  [ok  ] {station} ({target.stat().st_size / 1e6:.1f} MB)"


def download_weather(year: int = YEAR) -> None:
    """Hourly METAR per airport. Same fields the live API can fetch."""
    out_dir = RAW / "weather"
    out_dir.mkdir(parents=True, exist_ok=True)
    _run_jobs(
        IEM_JOBS,
        {s: (_fetch_station, (s, year, out_dir)) for s in AIRPORTS},
    )


def download_openflights() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    target = RAW / "airports.dat"
    if target.exists() and target.stat().st_size > 0:
        print("  [skip] airports.dat")
        return
    print("  [get ] airports.dat ...", flush=True)
    target.write_bytes(_get(OPENFLIGHTS_URL, timeout=120).content)
    print(f"  [ok  ] airports.dat ({target.stat().st_size / 1e3:.0f} KB)")


def _clear_sample_data() -> None:
    """`make smoke` writes files with the real names.

    Left alone they'd get skipped below and the model would train on random
    labels. Wipe them.
    """
    marker = RAW / "SAMPLE_DATA"
    if not marker.exists():
        return
    print("Found stand-in data from `make smoke`. Removing it before downloading.")
    for path in (RAW / "bts", RAW / "weather"):
        if path.exists():
            shutil.rmtree(path)
    marker.unlink()


def verify(year: int = YEAR) -> bool:
    """Check every file actually covers the year.

    Both servers will hand you a short body with a 200. A truncated weather
    file fails nothing -- it just silently leaves months of flights unjoined.
    """
    ok = True

    for month in range(1, 13):
        path = RAW / "bts" / f"bts_{year}_{month:02d}.csv"
        if not path.exists():
            print(f"  MISSING  {path.name}")
            ok = False
            continue
        with path.open() as fh:
            rows = sum(1 for _ in fh) - 1
        # smallest real month is still >400k
        if rows < 300_000:
            print(f"  SHORT    {path.name}: {rows:,} rows")
            ok = False
        else:
            print(f"  ok       {path.name}: {rows:,} rows")

    expected_hours = 366 * 24 if year % 4 == 0 else 365 * 24
    for station in AIRPORTS:
        path = RAW / "weather" / f"{station}.csv"
        if not path.exists():
            print(f"  MISSING  {station}.csv")
            ok = False
            continue
        with path.open() as fh:
            lines = fh.read().splitlines()
        rows = len(lines) - 1
        last = lines[-1].split(",")[1] if rows > 0 else ""
        # specials push this above hour count; well under = truncated
        if rows < expected_hours * 0.9 or not last.startswith(str(year)):
            print(f"  SHORT    {station}.csv: {rows:,} obs, last={last!r}")
            ok = False

    if not (RAW / "airports.dat").exists():
        print("  MISSING  airports.dat")
        ok = False

    print("\nAll files cover the full year." if ok
          else "\nRe-run `make download` - incomplete files are re-fetched "
               "once you delete them.")
    return ok


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--only",
        choices=["bts", "weather", "airports"],
        help="download a single source instead of all three",
    )
    ap.add_argument(
        "--verify",
        action="store_true",
        help="only check that existing files cover the whole year",
    )
    args = ap.parse_args()

    if args.verify:
        raise SystemExit(0 if verify() else 1)

    _clear_sample_data()

    steps = {
        "airports": ("OpenFlights", download_openflights),
        "weather": ("IEM METAR", download_weather),
        "bts": ("BTS on-time performance", download_bts),
    }
    chosen = [args.only] if args.only else ["airports", "weather", "bts"]
    for key in chosen:
        label, fn = steps[key]
        print(f"\n== {label} ==")
        fn()
    print("\n== verifying coverage ==")
    if not verify():
        raise SystemExit(1)
    print("\nDone. Raw files are under data/raw/.")


if __name__ == "__main__":
    main()
