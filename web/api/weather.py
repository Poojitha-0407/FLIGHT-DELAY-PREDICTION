"""Live weather for /predict.

Units are whatever the model trained on: kt, inches, statute miles, F.
Open-Meteo is asked for those directly so nothing drifts silently.
"""
from __future__ import annotations

import asyncio
import datetime as dt

import httpx

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
IEM_CURRENT = "https://mesonet.agron.iastate.edu/api/1/currents.json"

FIELDS = ("wind_kt", "gust_kt", "precip_in", "visibility_mi", "temp_f")
TIMEOUT = httpx.Timeout(6.0, connect=3.0)


# The model learned from METAR, which has two conventions a raw forecast
# doesn't share. Match them or the live values sit off-distribution.
METAR_MAX_VISIBILITY_MI = 10.0   # ASOS just reports "10" for anything clearer
METAR_GUST_THRESHOLD_KT = 18.0   # below this a gust isn't reported at all


def _metar_visibility(metres: float | None) -> float | None:
    if metres is None:
        return None
    return round(min(metres / 1609.344, METAR_MAX_VISIBILITY_MI), 2)


def _metar_gust(gust_kt: float | None) -> float:
    if gust_kt is None or gust_kt < METAR_GUST_THRESHOLD_KT:
        return 0.0
    return round(float(gust_kt), 1)


async def forecast(
    client: httpx.AsyncClient, lat: float, lon: float, tz: str, local_hour: dt.datetime
) -> dict:
    """Hourly forecast for one airport at one local hour."""
    day = local_hour.date().isoformat()
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "temperature_2m,precipitation,visibility,wind_speed_10m,wind_gusts_10m",
        "timezone": tz,
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "kn",
        "precipitation_unit": "inch",
        "start_date": day,
        "end_date": day,
    }
    r = await client.get(OPEN_METEO, params=params, timeout=TIMEOUT)
    r.raise_for_status()
    hourly = r.json()["hourly"]

    stamp = local_hour.strftime("%Y-%m-%dT%H:00")
    try:
        i = hourly["time"].index(stamp)
    except ValueError:
        return {}

    def at(key):
        series = hourly.get(key) or []
        return series[i] if i < len(series) else None

    visibility_m = at("visibility")
    return {
        "temp_f": at("temperature_2m"),
        "wind_kt": at("wind_speed_10m"),
        "gust_kt": _metar_gust(at("wind_gusts_10m")),
        "precip_in": at("precipitation"),
        # metres regardless of what units you ask for
        "visibility_mi": _metar_visibility(visibility_m),
        "source": "open-meteo",
    }


async def latest_metar(client: httpx.AsyncClient, station: str) -> dict:
    """Most recent ob for an ASOS station, in training units."""
    r = await client.get(
        IEM_CURRENT, params={"station": station, "network": "AWOS"}, timeout=TIMEOUT
    )
    r.raise_for_status()
    rows = r.json().get("data") or []
    if not rows:
        return {}
    ob = rows[0]
    gust = ob.get("gust")
    precip = ob.get("phour")
    return {
        "temp_f": ob.get("tmpf"),
        "wind_kt": ob.get("sknt"),
        "gust_kt": 0.0 if gust is None else gust,
        "precip_in": 0.0 if precip is None else precip,
        "visibility_mi": ob.get("vsby"),
        "source": "iem-metar",
    }


FORECAST_HORIZON_DAYS = 15   # open-meteo hourly runs ~16d out
PAST_HORIZON_DAYS = 2
METAR_RELEVANCE_HOURS = 3    # a current ob only describes an imminent departure


def _hours_away(local_hour: dt.datetime, tz: str) -> float:
    from zoneinfo import ZoneInfo

    now = dt.datetime.now(ZoneInfo(tz)).replace(tzinfo=None)
    return (local_hour - now).total_seconds() / 3600.0


async def _one(client, iata: str, airport: dict, local_hour: dt.datetime) -> dict:
    """Forecast, else latest ob if the flight is imminent, else nothing.

    The last case matters: for a departure months out, today's METAR describes
    today, not that day. Returning {} lets features.py fall back to the
    seasonal normal, which is the honest answer.
    """
    hours = _hours_away(local_hour, airport["tz"])
    within_forecast = -PAST_HORIZON_DAYS * 24 <= hours <= FORECAST_HORIZON_DAYS * 24

    if within_forecast:
        try:
            data = await forecast(
                client, airport["lat"], airport["lon"], airport["tz"], local_hour
            )
            if data and data.get("wind_kt") is not None:
                return data
        except Exception:  # noqa: BLE001 - a weather outage must not fail a prediction
            pass

    if abs(hours) <= METAR_RELEVANCE_HOURS:
        try:
            data = await latest_metar(client, iata)
            if data:
                return data
        except Exception:  # noqa: BLE001
            pass

    return {"source": "climatology (no forecast available for this date)"}


async def for_flight(
    origin_iata: str, origin: dict,
    dest_iata: str, dest: dict,
    dep_local: dt.datetime, arr_local: dt.datetime,
) -> tuple[dict, dict]:
    """Both airports at once. A weather outage degrades the prediction, never fails it."""
    async with httpx.AsyncClient() as client:
        origin_wx, dest_wx = await asyncio.gather(
            _one(client, origin_iata, origin, dep_local),
            _one(client, dest_iata, dest, arr_local),
        )
    return origin_wx, dest_wx
