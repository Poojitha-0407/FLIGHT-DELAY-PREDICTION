"""Run pipeline/sql/*.sql in order against DuckDB.

Parameters (airport list, split dates, file globs) go in as DuckDB variables
so config.py stays the only place they're written down.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import (  # noqa: E402
    AIRPORTS, DB_PATH, HOLIDAYS, PROCESSED, RAW, ROOT, TRAIN_END, VALID_END, YEAR,
)

SQL_DIR = Path(__file__).resolve().parent / "sql"


def _check_inputs() -> None:
    missing = []
    if not list((RAW / "bts").glob("*.csv")):
        missing.append("data/raw/bts/*.csv  (run: make download)")
    if not list((RAW / "weather").glob("*.csv")):
        missing.append("data/raw/weather/*.csv  (run: make download)")
    if not (RAW / "airports.dat").exists():
        missing.append("data/raw/airports.dat  (run: make download)")
    if missing:
        raise SystemExit("Missing raw inputs:\n  - " + "\n  - ".join(missing))


def _connect() -> duckdb.DuckDBPyConnection:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB_PATH))
    con.execute("INSTALL icu; LOAD icu;")  # AT TIME ZONE needs this

    # ~3 GB of CSV on a 16 GB laptop. Nothing here depends on row order --
    # every table is aggregated or explicitly sorted on the way out -- and
    # dropping the guarantee lets DuckDB parallelise the scan properly.
    con.execute("SET preserve_insertion_order = false")
    con.execute(f"SET temp_directory = '{(PROCESSED / 'duckdb_spill').as_posix()}'")
    con.execute(f"SET variable bts_glob = '{(RAW / 'bts' / '*.csv').as_posix()}'")
    con.execute(f"SET variable weather_glob = '{(RAW / 'weather' / '*.csv').as_posix()}'")
    con.execute(f"SET variable airports_dat = '{(RAW / 'airports.dat').as_posix()}'")
    con.execute(f"SET variable year = '{YEAR}'")
    con.execute(f"SET variable train_end = '{TRAIN_END}'")
    con.execute(f"SET variable valid_end = '{VALID_END}'")
    con.execute("SET variable holidays = ?", [HOLIDAYS])

    con.execute("CREATE OR REPLACE TABLE top_airports (iata VARCHAR)")
    con.executemany("INSERT INTO top_airports VALUES (?)", [(a,) for a in AIRPORTS])
    return con


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", help="run a single SQL file, e.g. 05 or 05_features")
    args = ap.parse_args()

    files = sorted(SQL_DIR.glob("*.sql"))
    if args.only:
        files = [f for f in files if f.stem.startswith(args.only.split("_")[0])]
        if not files:
            raise SystemExit(f"No SQL file matches {args.only!r}")
    else:
        _check_inputs()

    # COPY targets in the SQL are relative to the project root
    os.chdir(ROOT)

    con = _connect()
    for path in files:
        print(f"== {path.name}")
        started = time.time()
        con.execute(path.read_text())
        print(f"   {time.time() - started:.1f}s")

    has_features = con.execute(
        "SELECT count(*) FROM duckdb_tables() WHERE table_name = 'features'"
    ).fetchone()[0]
    if has_features:
        rows = con.execute(
            "SELECT split, count(*) n, round(avg(is_delayed), 4) rate "
            "FROM features GROUP BY split ORDER BY min(sched_dep_local)"
        ).fetchall()
        print("\nsplit      rows        delay rate")
        for split, n, rate in rows:
            print(f"{split:<10} {n:>10,}  {rate:>10.4f}")
    con.close()
    print(f"\nDatabase: {DB_PATH}")


if __name__ == "__main__":
    main()
