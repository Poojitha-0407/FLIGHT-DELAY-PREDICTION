# Known rough edges

Things I know are imperfect, roughly in the order they'd bite someone.

- **No tests.** `make smoke` covers the pipeline end to end on generated data,
  which catches schema and join breakage, but there's nothing unit-level. The
  obvious first targets are `features.build_row` against a known-good row from
  `features.parquet`, and `weather._metar_gust`/`_metar_visibility`.

- **`estimate_arrival` is crude.** 30 min taxi + 800 km/h cruise. Only used to
  pick the destination's weather hour and arrival-hour aggregate, so being off
  by 20 minutes usually doesn't change the bucket — but it will near the hour
  boundary. BTS has `CRSElapsedTime`; serving doesn't, which is the whole
  problem.

- **Holiday flag drifts.** Month-day matching, so Thanksgiving et al. are wrong
  by a few days in any year but 2025. Low impact, annoying to fix properly.

- **`flights.duckdb` grows.** DuckDB doesn't reclaim space across
  `CREATE OR REPLACE`, so it creeps past 600 MB after a few runs.
  `make clean-data && make transform` rebuilds it at ~400 MB.

- **`agg_routes` cuts at 100 flights/year** and the dashboard chart cuts again
  at 1000. Both numbers were picked by eye.

- **Carrier is a bare categorical.** No aircraft type, no fleet age, no hub
  flag. Carrier only carries 2.3% of gain, so this may not be worth much.

- **One year of data.** Means the chronological split can't see a second
  December, which is the whole reason `model_deploy.txt` exists. Two or three
  years would let the test window be a full annual cycle and make the reported
  numbers a lot more meaningful.

- **`web/api/features.py` duplicates the holiday list** from `pipeline/config.py`
  because the serverless bundle only ships `api/`. If one changes the other
  won't, and nothing will tell you.
