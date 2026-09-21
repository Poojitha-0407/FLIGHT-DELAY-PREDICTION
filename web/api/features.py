"""Serving twin of pipeline/sql/05_features.sql.

These two have to stay in step. Column order comes from feature_config.json,
which training writes, so at least the ordering can't drift silently.
"""
from __future__ import annotations

import datetime as dt
import json
import math
from functools import lru_cache
from pathlib import Path

ARTIFACTS = Path(__file__).resolve().parent / "_artifacts"

# Duplicated from pipeline/config.py -- the serverless bundle only ships api/.
# Month-day so they carry forward, which means the floating ones (MLK, Memorial,
# Labor, Thanksgiving) drift a few days in later years. One binary feature on a
# handful of dates; a real holiday calendar isn't worth the bundle weight.
# TODO: revisit if is_holiday ever gains importance.
HOLIDAYS = {
    "01-01", "01-20", "02-17", "05-26", "06-19", "07-04", "09-01",
    "10-13", "11-11", "11-26", "11-27", "11-28", "11-30",
    "12-23", "12-24", "12-25", "12-26", "12-28", "12-31",
}

EARTH_RADIUS_KM = 6371.0


@lru_cache(maxsize=1)
def load_config() -> dict:
    return json.loads((ARTIFACTS / "feature_config.json").read_text())


@lru_cache(maxsize=1)
def load_lookups() -> dict:
    return json.loads((ARTIFACTS / "lookups.json").read_text())


@lru_cache(maxsize=1)
def load_calibration() -> dict | None:
    path = ARTIFACTS / "calibration.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def estimate_arrival(
    dep_local: dt.datetime, origin_tz: str, dest_tz: str, distance_km: float
) -> dt.datetime:
    """Scheduled arrival, destination local time.

    30 min taxi + 800 km/h cruise. Only needs to be right to the hour -- it
    picks the destination weather hour and the arrival-hour aggregates.
    """
    from zoneinfo import ZoneInfo

    block = dt.timedelta(minutes=round(30 + 60 * distance_km / 800.0))
    dep_aware = dep_local.replace(tzinfo=ZoneInfo(origin_tz))
    return (
        (dep_aware + block)
        .astimezone(ZoneInfo(dest_tz))
        .replace(tzinfo=None, second=0, microsecond=0)
    )


def build_row(
    *,
    origin: str,
    dest: str,
    carrier: str,
    dep_local: dt.datetime,
    origin_weather: dict,
    dest_weather: dict,
) -> tuple[list[float], dict]:
    """-> (vector in config order, the named values behind it)."""
    cfg = load_config()
    lk = load_lookups()
    defaults = cfg["defaults"]
    airports = lk["airports"]

    o, d = airports[origin], airports[dest]
    distance_km = haversine_km(o["lat"], o["lon"], d["lat"], d["lon"])
    arr_local = estimate_arrival(dep_local, o["tz"], d["tz"], distance_km)

    dep_hour = dep_local.hour
    arr_hour = arr_local.hour
    dow = dep_local.isoweekday()          # 1 = Monday, matching BTS DayOfWeek
    month = dep_local.month
    g = lk["global_delay_rate"]

    normals = lk.get("weather_normals", {})
    origin_normal = normals.get(f"{origin}-{dep_local.month}", {})
    dest_normal = normals.get(f"{dest}-{arr_local.month}", {})

    def _w(src: dict, key: str, feature: str, normal: dict):
        """Live reading -> that airport's monthly normal -> train median.

        The middle step matters: the global median temp is 69F, and handing
        that to a Chicago flight in December told the model it was summer.
        """
        value = src.get(key)
        if value is not None:
            return float(value)
        value = normal.get(key)
        if value is not None:
            return float(value)
        return defaults.get(feature)

    values = {
        "hour_sin": math.sin(2 * math.pi * dep_hour / 24.0),
        "hour_cos": math.cos(2 * math.pi * dep_hour / 24.0),
        "dow_sin": math.sin(2 * math.pi * (dow - 1) / 7.0),
        "dow_cos": math.cos(2 * math.pi * (dow - 1) / 7.0),
        "month_sin": math.sin(2 * math.pi * (month - 1) / 12.0),
        "month_cos": math.cos(2 * math.pi * (month - 1) / 12.0),
        "is_holiday": 1.0 if dep_local.strftime("%m-%d") in HOLIDAYS else 0.0,

        "distance_km": distance_km,
        "origin_lat": o["lat"], "origin_lon": o["lon"],
        "dest_lat": d["lat"], "dest_lon": d["lon"],

        # no future schedule to count, so use the airport's typical hour profile
        "origin_dep_density": lk["origin_dep_density"].get(
            f"{origin}-{dep_hour}", defaults["origin_dep_density"]),
        "dest_arr_density": lk["dest_arr_density"].get(
            f"{dest}-{arr_hour}", defaults["dest_arr_density"]),

        "route_delay_rate": lk["route_delay_rate"].get(f"{origin}-{dest}", g),
        "origin_hour_delay_rate": lk["origin_hour_delay_rate"].get(f"{origin}-{dep_hour}", g),
        "dest_hour_delay_rate": lk["dest_hour_delay_rate"].get(f"{dest}-{arr_hour}", g),
        "carrier_delay_rate": lk["carrier_delay_rate"].get(carrier, g),

        "origin_wind_kt": _w(origin_weather, "wind_kt", "origin_wind_kt", origin_normal),
        "origin_gust_kt": _w(origin_weather, "gust_kt", "origin_gust_kt", origin_normal),
        "origin_precip_in": _w(origin_weather, "precip_in", "origin_precip_in", origin_normal),
        "origin_visibility_mi": _w(
            origin_weather, "visibility_mi", "origin_visibility_mi", origin_normal),
        "origin_temp_f": _w(origin_weather, "temp_f", "origin_temp_f", origin_normal),
        "dest_wind_kt": _w(dest_weather, "wind_kt", "dest_wind_kt", dest_normal),
        "dest_gust_kt": _w(dest_weather, "gust_kt", "dest_gust_kt", dest_normal),
        "dest_precip_in": _w(dest_weather, "precip_in", "dest_precip_in", dest_normal),
        "dest_visibility_mi": _w(dest_weather, "visibility_mi", "dest_visibility_mi", dest_normal),
        "dest_temp_f": _w(dest_weather, "temp_f", "dest_temp_f", dest_normal),
    }

    vocab = cfg["carrier_vocab"]
    values["carrier"] = float(vocab.index(carrier)) if carrier in vocab else -1.0

    vector = [float(values[name]) for name in cfg["features"]]
    values["_scheduled_arrival_local"] = arr_local.isoformat()
    return vector, values


def calibrate(prob: float) -> float:
    """Piecewise-linear isotonic fit from the validation month."""
    calib = load_calibration()
    if not calib:
        return prob
    xs, ys = calib["x"], calib["y"]
    if prob <= xs[0]:
        return ys[0]
    if prob >= xs[-1]:
        return ys[-1]
    for i in range(1, len(xs)):
        if prob <= xs[i]:
            x0, x1, y0, y1 = xs[i - 1], xs[i], ys[i - 1], ys[i]
            if x1 == x0:
                return y1
            return y0 + (prob - x0) * (y1 - y0) / (x1 - x0)
    return ys[-1]
