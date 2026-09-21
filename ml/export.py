"""Export everything the API needs into web/api/_artifacts/.

Model, feature config, the lookups that stand in for the database at request
time, and the dashboard aggregates. All text or JSON -- no DuckDB, no parquet
reader in the deployed function.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys

import duckdb

from common import MODEL_DIR, REPORT_DIR, ROOT

sys.path.insert(0, str(ROOT / "pipeline"))
from config import DB_PATH, TRAIN_END, VALID_END, YEAR  # noqa: E402

ARTIFACTS = ROOT / "web" / "api" / "_artifacts"


def _rows(con, sql: str) -> list[dict]:
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def build_lookups(con) -> dict:
    airports = {
        r["iata"]: {
            "name": r["name"], "city": r["city"],
            "lat": r["lat"], "lon": r["lon"], "tz": r["tz"],
        }
        for r in _rows(con, "SELECT iata, name, city, lat, lon, tz FROM airports")
    }
    return {
        "airports": airports,
        "global_delay_rate": con.execute("SELECT rate FROM global_rate").fetchone()[0],
        "route_delay_rate": {
            f"{r['origin']}-{r['dest']}": round(r["route_delay_rate"], 6)
            for r in _rows(con, "SELECT origin, dest, route_delay_rate FROM route_rates")
        },
        "origin_hour_delay_rate": {
            f"{r['origin']}-{r['hour_of_day']}": round(r["origin_hour_delay_rate"], 6)
            for r in _rows(
                con, "SELECT origin, hour_of_day, origin_hour_delay_rate FROM origin_hour_rates")
        },
        "dest_hour_delay_rate": {
            f"{r['dest']}-{r['hour_of_day']}": round(r["dest_hour_delay_rate"], 6)
            for r in _rows(
                con, "SELECT dest, hour_of_day, dest_hour_delay_rate FROM dest_hour_rates")
        },
        "carrier_delay_rate": {
            r["carrier"]: round(r["carrier_delay_rate"], 6)
            for r in _rows(con, "SELECT carrier, carrier_delay_rate FROM carrier_rates")
        },
        # climatology past the forecast horizon -- see 03_weather.sql
        "weather_normals": {
            f"{r['station']}-{r['month']}": {
                "wind_kt": r["wind_kt"], "gust_kt": r["gust_kt"],
                "precip_in": r["precip_in"], "visibility_mi": r["visibility_mi"],
                "temp_f": r["temp_f"],
            }
            for r in _rows(con, "SELECT * FROM weather_normals")
        },
        "origin_dep_density": {
            f"{r['origin']}-{r['hour_of_day']}": round(float(r["origin_dep_density"]), 2)
            for r in _rows(
                con, "SELECT origin, hour_of_day, origin_dep_density FROM dep_density_profile")
        },
        "dest_arr_density": {
            f"{r['dest']}-{r['hour_of_day']}": round(float(r["dest_arr_density"]), 2)
            for r in _rows(
                con, "SELECT dest, hour_of_day, dest_arr_density FROM arr_density_profile")
        },
    }


def build_dashboard(con) -> dict:
    metrics_path = REPORT_DIR / "metrics_test.json"
    metrics = json.loads(metrics_path.read_text())["metrics"] if metrics_path.exists() else None
    return {
        "meta": {
            "year": YEAR,
            "train_end": TRAIN_END,
            "valid_end": VALID_END,
            "target": "arrival more than 30 minutes late",
        },
        "model_metrics": metrics,
        # These ORDER BYs are load-bearing. The frontend plots the arrays in
        # order, and run_sql.py disables insertion order, so a table's own
        # ORDER BY doesn't survive storage.
        "routes": _rows(con, "SELECT * FROM agg_routes ORDER BY flights DESC"),
        "airports": _rows(con, "SELECT * FROM agg_airports ORDER BY departures DESC"),
        "airport_hours": _rows(
            con, "SELECT * FROM agg_airport_hours ORDER BY iata, hour_of_day"),
        "carriers": _rows(con, "SELECT * FROM agg_carriers ORDER BY flights DESC"),
        "monthly": _rows(con, "SELECT * FROM agg_monthly ORDER BY month"),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--indent", type=int, default=None, help="pretty-print the JSON")
    args = ap.parse_args()

    for required in (MODEL_DIR / "model.txt", MODEL_DIR / "feature_config.json"):
        if not required.exists():
            raise SystemExit(f"{required} not found. Run: make train")
    if not DB_PATH.exists():
        raise SystemExit(f"{DB_PATH} not found. Run: make transform")

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB_PATH), read_only=True)
    con.execute("LOAD icu;")

    # Ship the refit when it exists; the chronological model stays behind in
    # ml/artifacts/ for evaluate.py. See refit_full().
    deploy = MODEL_DIR / "model_deploy.txt"
    shutil.copy2(deploy if deploy.exists() else MODEL_DIR / "model.txt",
                 ARTIFACTS / "model.txt")
    print("Shipping", "model_deploy.txt (refit on all 12 months)"
          if deploy.exists() else "model.txt (chronological fit)")
    for name in ("feature_config.json", "calibration.json"):
        src = MODEL_DIR / name
        if src.exists():
            shutil.copy2(src, ARTIFACTS / name)

    (ARTIFACTS / "lookups.json").write_text(json.dumps(build_lookups(con), indent=args.indent))
    (ARTIFACTS / "dashboard.json").write_text(json.dumps(build_dashboard(con), indent=args.indent))
    con.close()

    print(f"Exported to {ARTIFACTS.relative_to(ROOT)}")
    total = 0
    for f in sorted(ARTIFACTS.iterdir()):
        kb = f.stat().st_size / 1024
        total += kb
        print(f"  {f.name:<22} {kb:>8.1f} KB")
    print(f"  {'total':<22} {total:>8.1f} KB")
    if total > 40_000:
        print("\nWARNING: artifacts exceed ~40 MB; Vercel's function bundle limit is 250 MB "
              "uncompressed including dependencies.")


if __name__ == "__main__":
    main()
