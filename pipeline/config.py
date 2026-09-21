"""Airports, date span, split boundaries. Everything else reads from here."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
DB_PATH = PROCESSED / "flights.duckdb"

YEAR = 2025

# Chronological split. Aggregates come from TRAIN only -- see 04_congestion.sql.
TRAIN_END = "2025-10-01"   # exclusive
VALID_END = "2025-11-01"   # exclusive
TEST_END = "2026-01-01"    # exclusive

# 30 busiest by passenger boardings
AIRPORTS = [
    "ATL", "DFW", "DEN", "ORD", "LAX", "CLT", "MCO", "LAS", "PHX", "MIA",
    "SEA", "IAH", "JFK", "EWR", "FLL", "MSP", "SFO", "DTW", "BOS", "SLC",
    "PHL", "BWI", "TPA", "SAN", "LGA", "MDW", "BNA", "IAD", "DCA", "AUS",
]

# Federal holidays plus the Thanksgiving/Christmas travel days that actually
# move delay rates. 2025 only.
HOLIDAYS = [
    "2025-01-01",  # New Year's Day
    "2025-01-20",  # MLK Day
    "2025-02-17",  # Presidents' Day
    "2025-05-26",  # Memorial Day
    "2025-06-19",  # Juneteenth
    "2025-07-04",  # Independence Day
    "2025-09-01",  # Labor Day
    "2025-10-13",  # Columbus Day
    "2025-11-11",  # Veterans Day
    "2025-11-26",  # Thanksgiving eve
    "2025-11-27",  # Thanksgiving
    "2025-11-28",
    "2025-11-30",  # Thanksgiving Sunday
    "2025-12-23",
    "2025-12-24",
    "2025-12-25",  # Christmas
    "2025-12-26",
    "2025-12-28",
    "2025-12-31",
]

# What the model sees. Here so training and serving can't drift apart.
NUMERIC_FEATURES = [
    "hour_sin", "hour_cos",
    "dow_sin", "dow_cos",
    "month_sin", "month_cos",
    "is_holiday",
    "distance_km",
    "origin_lat", "origin_lon", "dest_lat", "dest_lon",
    "origin_dep_density", "dest_arr_density",
    "route_delay_rate", "origin_hour_delay_rate", "dest_hour_delay_rate",
    "carrier_delay_rate",
    "origin_wind_kt", "origin_gust_kt", "origin_precip_in",
    "origin_visibility_mi", "origin_temp_f",
    "dest_wind_kt", "dest_gust_kt", "dest_precip_in",
    "dest_visibility_mi", "dest_temp_f",
]
CATEGORICAL_FEATURES = ["carrier"]
FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES
TARGET = "is_delayed"
