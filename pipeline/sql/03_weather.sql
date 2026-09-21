-- METAR -> hourly observations on airport local time.
-- IEM serves UTC; BTS schedules are local, so convert before joining.

CREATE OR REPLACE TABLE weather AS
WITH raw AS (
    SELECT
        station,
        TRY_CAST(valid AS TIMESTAMP) AS valid_utc,
        TRY_CAST(NULLIF(tmpf, 'M') AS DOUBLE) AS temp_f,
        TRY_CAST(NULLIF(sknt, 'M') AS DOUBLE) AS wind_kt,
        TRY_CAST(NULLIF(gust, 'M') AS DOUBLE) AS gust_kt,
        TRY_CAST(NULLIF(p01i, 'M') AS DOUBLE) AS precip_in,
        TRY_CAST(NULLIF(vsby, 'M') AS DOUBLE) AS visibility_mi
    FROM read_csv_auto(
        getvariable('weather_glob'),
        union_by_name = true,
        all_varchar = true,
        ignore_errors = true
    )
    WHERE station IN (SELECT iata FROM top_airports)
),
localised AS (
    SELECT
        r.station,
        r.valid_utc,
        date_trunc('hour', (r.valid_utc AT TIME ZONE 'UTC') AT TIME ZONE a.tz) AS local_hour,
        r.temp_f,
        r.wind_kt,
        COALESCE(r.gust_kt, 0.0) AS gust_kt,      -- no gust reported = no gust
        COALESCE(r.precip_in, 0.0) AS precip_in,
        r.visibility_mi
    FROM raw r
    JOIN airports a ON a.iata = r.station
    WHERE r.valid_utc IS NOT NULL
)
SELECT station, local_hour, temp_f, wind_kt, gust_kt, precip_in, visibility_mi
FROM localised
-- specials can land in the same hour as the routine ob; keep the routine one
QUALIFY row_number() OVER (PARTITION BY station, local_hour ORDER BY valid_utc) = 1;

CREATE INDEX IF NOT EXISTS weather_lookup ON weather (station, local_hour);

-- Climatology for dates past the forecast horizon. Deliberately NOT train-only:
-- Jan-Sep can't describe Nov/Dec, which is exactly when this gets used, and
-- these never enter training so there's nothing to leak. Means not medians --
-- median precip is 0 everywhere, which would promise a dry day every time.
-- Year filter drops the handful of rows that UTC->local pulls back into Dec 2024.
CREATE OR REPLACE TABLE weather_normals AS
SELECT
    station,
    EXTRACT(month FROM local_hour)::INTEGER AS month,
    round(avg(wind_kt), 2)       AS wind_kt,
    round(avg(gust_kt), 2)       AS gust_kt,
    round(avg(precip_in), 4)     AS precip_in,
    round(avg(visibility_mi), 2) AS visibility_mi,
    round(avg(temp_f), 1)        AS temp_f
FROM weather
WHERE EXTRACT(year FROM local_hour) = CAST(getvariable('year') AS INTEGER)
GROUP BY ALL
ORDER BY station, month;
