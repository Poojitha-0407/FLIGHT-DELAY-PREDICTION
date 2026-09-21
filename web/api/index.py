"""FastAPI app behind /api/*.

Loads the model and lookups once at cold start, then per request: fetch
weather, rebuild the training feature vector, return a calibrated probability.
"""
from __future__ import annotations

import datetime as dt
import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

import lightgbm as lgb
import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

import weather
from features import build_row, calibrate, estimate_arrival, haversine_km, load_config, load_lookups

ARTIFACTS = Path(__file__).resolve().parent / "_artifacts"

app = FastAPI(
    title="Flight Delay Platform API",
    description="Probability that a US domestic flight arrives more than 30 minutes late.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def model() -> lgb.Booster:
    return lgb.Booster(model_file=str(ARTIFACTS / "model.txt"))


@lru_cache(maxsize=1)
def dashboard() -> dict:
    return json.loads((ARTIFACTS / "dashboard.json").read_text())


class PredictRequest(BaseModel):
    origin: str = Field(..., min_length=3, max_length=3, examples=["JFK"])
    dest: str = Field(..., min_length=3, max_length=3, examples=["LAX"])
    carrier: str = Field(..., min_length=2, max_length=3, examples=["AA"])
    departure_local: dt.datetime = Field(
        ...,
        description="Scheduled departure in the ORIGIN airport's local time, ISO-8601.",
        examples=["2026-03-14T17:30:00"],
    )

    @field_validator("origin", "dest", "carrier")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.strip().upper()


class Driver(BaseModel):
    feature: str
    value: float
    contribution: float
    direction: Literal["increases", "decreases"]


class PredictResponse(BaseModel):
    probability: float
    probability_uncalibrated: float
    risk_band: Literal["low", "moderate", "elevated", "high"]
    baseline_route_rate: float | None
    scheduled_arrival_local: str
    distance_km: float
    weather: dict
    top_drivers: list[Driver]


WEATHER_FIELDS = ("wind_kt", "gust_kt", "precip_in", "visibility_mi", "temp_f")


def _resolved(named: dict, side: str, fetched: dict) -> dict:
    """What the model actually consumed, which past the forecast horizon is the
    monthly normal rather than the empty fetch."""
    out = {f: named[f"{side}_{f}"] for f in WEATHER_FIELDS}
    out["source"] = fetched.get("source", "climatology")
    return out


def risk_band(p: float) -> str:
    if p < 0.15:
        return "low"
    if p < 0.30:
        return "moderate"
    if p < 0.50:
        return "elevated"
    return "high"


@app.get("/api/health")
def health() -> dict:
    cfg = load_config()
    return {
        "status": "ok",
        "model_iterations": model().num_trees(),
        "features": len(cfg["features"]),
        "carriers": len(cfg["carrier_vocab"]),
        "trained_on_rows": cfg["train_rows"],
        "target": cfg["target"],
    }


@app.get("/api/airports")
def airports() -> dict:
    """Reference data + full-year summary per airport."""
    lk = load_lookups()
    summary = {a["iata"]: a for a in dashboard()["airports"]}
    return {
        "airports": [
            {"iata": iata, **meta, "summary": summary.get(iata)}
            for iata, meta in sorted(lk["airports"].items())
        ]
    }


@app.get("/api/airports/{iata}/hours")
def airport_hours(iata: str) -> dict:
    iata = iata.upper()
    rows = [r for r in dashboard()["airport_hours"] if r["iata"] == iata]
    if not rows:
        raise HTTPException(404, f"No hourly profile for {iata}")
    return {"iata": iata, "hours": rows}


@app.get("/api/routes")
def routes(
    origin: str | None = None,
    dest: str | None = None,
    min_flights: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
    sort: Literal["flights", "delay_rate", "avg_delay_min"] = "flights",
) -> dict:
    rows = dashboard()["routes"]
    if origin:
        rows = [r for r in rows if r["origin"] == origin.upper()]
    if dest:
        rows = [r for r in rows if r["dest"] == dest.upper()]
    if min_flights:
        rows = [r for r in rows if r["flights"] >= min_flights]
    rows = sorted(rows, key=lambda r: r[sort] or 0, reverse=True)
    return {"count": len(rows), "routes": rows[:limit]}


@app.get("/api/dashboard")
def dashboard_summary() -> dict:
    """Everything the charts need except the route list, which is large."""
    d = dashboard()
    return {
        "meta": d["meta"],
        "model_metrics": d["model_metrics"],
        "carriers": d["carriers"],
        "monthly": d["monthly"],
        "airports": d["airports"],
    }


@app.get("/api/carriers")
def carriers() -> dict:
    return {"carriers": dashboard()["carriers"]}


@app.post("/api/predict", response_model=PredictResponse)
async def predict(req: PredictRequest) -> PredictResponse:
    lk = load_lookups()
    known = lk["airports"]
    for code in (req.origin, req.dest):
        if code not in known:
            raise HTTPException(
                400, f"{code} is outside the 30 airports this model covers."
            )
    if req.origin == req.dest:
        raise HTTPException(400, "Origin and destination must differ.")

    o, d = known[req.origin], known[req.dest]
    dep_local = req.departure_local.replace(tzinfo=None, second=0, microsecond=0)
    distance_km = haversine_km(o["lat"], o["lon"], d["lat"], d["lon"])
    arr_local = estimate_arrival(dep_local, o["tz"], d["tz"], distance_km)

    origin_wx, dest_wx = await weather.for_flight(
        req.origin, o, req.dest, d, dep_local, arr_local
    )

    vector, named = build_row(
        origin=req.origin, dest=req.dest, carrier=req.carrier,
        dep_local=dep_local, origin_weather=origin_wx, dest_weather=dest_wx,
    )

    booster = model()
    x = np.asarray([vector], dtype=np.float64)
    raw = float(booster.predict(x)[0])
    prob = calibrate(raw)
    contributions = booster.predict(x, pred_contrib=True)[0][:-1]  # drop bias

    cfg = load_config()
    ranked = sorted(
        zip(cfg["features"], vector, contributions),
        key=lambda t: abs(t[2]), reverse=True,
    )[:5]

    return PredictResponse(
        probability=round(prob, 4),
        probability_uncalibrated=round(raw, 4),
        risk_band=risk_band(prob),
        baseline_route_rate=lk["route_delay_rate"].get(f"{req.origin}-{req.dest}"),
        scheduled_arrival_local=named["_scheduled_arrival_local"],
        distance_km=round(distance_km, 1),
        weather={
            "origin": _resolved(named, "origin", origin_wx),
            "dest": _resolved(named, "dest", dest_wx),
        },
        top_drivers=[
            Driver(
                feature=name,
                value=round(float(value), 4),
                contribution=round(float(contrib), 4),
                direction="increases" if contrib > 0 else "decreases",
            )
            for name, value, contrib in ranked
        ],
    )


@app.get("/api/predict", response_model=PredictResponse)
async def predict_get(
    origin: str, dest: str, carrier: str, departure_local: dt.datetime
) -> PredictResponse:
    """Query-string form. Handy for curl."""
    return await predict(PredictRequest(
        origin=origin, dest=dest, carrier=carrier, departure_local=departure_local
    ))
