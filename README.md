# Flight Delay Platform

Probability that a US domestic flight arrives **more than 30 minutes late**, using
only what's knowable before pushback. One year of BTS on-time performance for the
30 busiest airports, joined to hourly METAR, modelled with LightGBM, served from a
FastAPI function behind a Next.js map.

Test ROC-AUC **0.708**, PR-AUC **0.350** against a 16.7% base rate.

## Running it

```bash
make setup      # .venv + deps (needs uv)
make smoke      # whole pipeline on generated data, ~1 min
```

Then for real:

```bash
make download   # ~3 GB into data/raw/
make verify
make all        # transform -> train -> evaluate -> export
cd web && npm install
```

Two terminals to run it:

```bash
make api        # :8000, docs at /docs
make web        # :3000, proxies /api/* to :8000
```

`make dev` runs the deployed shape via `vercel dev` instead, which needs the CLI
and a linked project. The two-process setup needs neither.

Run `make smoke` before the download. It generates BTS/IEM-shaped files with
random labels and pushes them through every stage, so schema problems show up in
a minute rather than after an hour of downloading. Its metrics are meaningless by
construction. Those files use the real filenames, so `sample_data.py` drops a
`data/raw/SAMPLE_DATA` marker and `make download` wipes them first.

**Needs:** [uv](https://docs.astral.sh/uv/), Node 20+. A
[Mapbox token](https://account.mapbox.com/access-tokens/) in `web/.env.local` is
optional. Without one the map draws the network on a plain backdrop, which still
reads fine; a token just adds terrain.

**macOS:** LightGBM's wheel wants `libomp`, which macOS doesn't ship and which
normally comes from Homebrew. `make setup` instead copies the one scikit-learn
already bundles into LightGBM's `lib/` and adds an `@loader_path` rpath, so it
stays inside `.venv` and needs no env var. Re-run `make libomp` after reinstalling
LightGBM.

## Decisions

| | | |
| --- | --- | --- |
| Data | Jan–Dec 2025, top 30 airports | full seasonality, fits on a laptop |
| Target | arrival >30 min late | the delay passengers actually feel |
| Features | pre-departure only | no leakage; training matches inference |
| Split | train Jan–Sep, valid Oct, test Nov–Dec | chronological, like real use |
| Aggregates | train period only | no leakage |

Cancelled and diverted flights are out of the model (no arrival delay to predict)
but kept in `flight_disruptions` and reported as cancellation rates.

## Layout

```
pipeline/   download -> DuckDB SQL -> features.parquet
  config.py         airports, split dates, feature list
  sql/01..06        one table per file
ml/         train, evaluate, export
web/        api/ (FastAPI + _artifacts/) and the Next.js frontend
data/       gitignored
```

## Features

Time (hour/dow/month as sin-cos, holiday flag), geography (Haversine, coords),
congestion (scheduled departures at origin in the hour, arrivals at destination),
delay history (by route, airport×hour, carrier), weather at both ends, carrier.

The history group stands in for delay propagation: you can't know the previous
leg of a flight that hasn't been scheduled, so the model learns which routes,
hours and carriers *tend* to propagate instead. All rates are smoothed toward the
global mean (k=50) so a four-flight route can't claim a 100% delay rate.

## Leakage

1. No post-departure columns. Actual departure, taxi, air time and the BTS
   delay-cause breakdown never enter the feature table.
2. Every delay rate comes from Jan–Sep and is joined onto all three splits.
   Congestion counts come off the published schedule, so those use the full year.
3. October is the early-stopping set; Nov–Dec isn't touched until `make evaluate`.

## Two models

`make train` writes both:

- `model.txt` — Jan–Sep, early-stopped on Oct. What `make evaluate` scores.
- `model_deploy.txt` — all twelve months at the same round count. What ships.

The chronological one is right to measure and wrong to deploy. Having never seen
a November, its `month_sin`/`month_cos` for Nov–Dec sit outside its training range
and it extrapolates. Monthly error is ±0.0007 inside the range, then −0.048 in
November and −0.063 in December. Refitting on the full year removes the
extrapolation. Rounds are inherited rather than re-searched; there's no held-out
set left. Reported metrics always come from the chronological model.

## Train/serve parity

`web/api/features.py` is the serving twin of `pipeline/sql/05_features.sql`, and
column order comes from `feature_config.json` so at least that can't drift.

Two METAR conventions a raw forecast doesn't share, both of which bit:

- Visibility caps at 10 SM. ASOS reports `10` for anything clearer, so training
  has nothing above it. Open-Meteo was handing over 49.
- Gusts under 18 kt report as 0. METAR only encodes a gust when it's significant,
  which the pipeline reads as none.

Weather resolves forecast → latest observation (only within 3 hours; a current ob
doesn't describe a flight in March) → that airport's monthly normal. The response
says which. The normals matter more than they look. The first version fell back to
one global median per feature, including 69°F, which told a December Chicago flight
it was summer. That run returned 2.0% against an empirical 16%.

Known approximation: the holiday flag matches on month-day, so floating holidays
drift a few days in later years.

## Results

2,496,306 flights; 1,868,415 in the training window.

| | | |
| --- | --- | --- |
| ROC-AUC | 0.708 | 0.5 = coin flip |
| PR-AUC | 0.350 | 0.167 base rate, 2.09× |
| Brier | 0.1295 | vs 0.1394 predicting the base rate |
| Log loss | 0.4207 | |

Worst decile is delayed 42.2% of the time, best decile 4.0%. Top features by gain:
`origin_hour_delay_rate` 21.0%, `dest_hour_delay_rate` 12.4%, `month_cos` 9.2%,
`origin_precip_in` 6.3%. Carrier is 2.3%: when and where you depart matters far
more than who you fly.

Delay rate runs 11.5% in January to 22.8% in July; ATL climbs from ~5% at 05:00 to
~30% by 23:00 as the day compounds; the worst corridors are EWR-dominated. All of
which is what the data should say, which is mildly reassuring.

Two clean runs produce byte-identical models. That needs LightGBM's `deterministic`
mode *and* a total ordering on `features.parquet`. Without both, thread scheduling
and ~48 ambiguously ordered rows move `best_iteration` around. `--fast` drops it
when iterating.

## API

Under `/api`, docs at `/docs` with `make api`.

`GET /health` `/airports` `/airports/{iata}/hours` `/routes` `/dashboard`
`/carriers`, and `/predict` as either GET or POST.

```bash
curl "localhost:8000/api/predict?origin=ORD&dest=DEN&carrier=UA&departure_local=2026-01-15T07:00:00"
```

`top_drivers` comes from LightGBM's own per-prediction contributions, so it's the
model's decomposition rather than a story told afterwards.

## Interface

Design lineage, since it isn't invented from scratch:

- **Layout from Flightradar24.** Full-bleed map with the chrome floating on top
  of it, tools collected in a pill at the bottom, detail panel overlaying rather
  than occupying a column. The deck gets a left padding so the network centres
  in the visible area instead of behind the panel, which is the same trick FR24
  and Google Maps use.
- **Chrome from Linear.** Inter at weight 510 with -0.022em tracking, `#08090a`,
  13px UI text, fully rounded buttons, 1px borders at 8% white.
- **Instruments from actual avionics.** The one part that isn't borrowed. Risk
  renders as an attitude indicator, with the horizon riding on the route's own
  historical rate so the gap to the aircraft symbol is the model's contribution.
  Weather renders in METAR grammar (`EWR 09G20KT 10SM 15C FCST`).

`A` toggles analysis, `Esc` closes it and clears the airport filter.

The entry sequence is procedural Three.js: windscreen aperture, airglow horizon,
city lights below, camera easing back off the glass. No model to download. Esc
skips, once per session, bypassed under `prefers-reduced-motion`. It plays while
the API calls are in flight.

The colour ramp is anchored on the 5th/95th percentiles of the real route
distribution. It used to run 0.10-0.45 while 90% of routes sit between 0.087 and
0.214, so nearly every arc came out the same yellow. That fix then made the
"worst routes" chart all red for the same reason in reverse, so it now shows both
ends of the distribution.

## Deploying

Vercel root is `web/`. `vercel.json` declares `api/index.py` as a Python function
and rewrites `/api/*` to it. `web/api/_artifacts/` is committed output from
`make export`; redeploy after retraining or you'll serve the old model. Set
`NEXT_PUBLIC_MAPBOX_TOKEN` in the project env if you want terrain.

## Sources

[BTS on-time performance](https://www.transtats.bts.gov/Tables.asp?QO_VQ=EFD) ·
[IEM ASOS archive](https://mesonet.agron.iastate.edu/request/download.phtml) ·
[OpenFlights](https://openflights.org/data.html) ·
[Open-Meteo](https://open-meteo.com/) for live forecasts
