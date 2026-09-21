-- The feature table. Everything here is knowable before pushback -- no actual
-- departure time, no taxi, no air time, none of the BTS delay-cause columns.

CREATE OR REPLACE TABLE holidays AS
SELECT CAST(d AS DATE) AS holiday
FROM (SELECT unnest(getvariable('holidays')) AS d);

CREATE OR REPLACE TABLE features AS
SELECT
    f.flight_date,
    f.sched_dep_local,
    f.split,
    f.carrier,
    f.origin,
    f.dest,
    f.dep_hour,
    f.arr_hour,

    -- time
    sin(2 * pi() * f.dep_hour / 24.0)           AS hour_sin,
    cos(2 * pi() * f.dep_hour / 24.0)           AS hour_cos,
    sin(2 * pi() * (f.day_of_week - 1) / 7.0)   AS dow_sin,
    cos(2 * pi() * (f.day_of_week - 1) / 7.0)   AS dow_cos,
    sin(2 * pi() * (f.month - 1) / 12.0)        AS month_sin,
    cos(2 * pi() * (f.month - 1) / 12.0)        AS month_cos,
    CAST(h.holiday IS NOT NULL AS TINYINT)      AS is_holiday,

    -- geography
    2 * 6371.0 * asin(sqrt(
        pow(sin(radians(d.lat - o.lat) / 2), 2)
        + cos(radians(o.lat)) * cos(radians(d.lat))
          * pow(sin(radians(d.lon - o.lon) / 2), 2)
    ))                                          AS distance_km,
    o.lat AS origin_lat, o.lon AS origin_lon,
    d.lat AS dest_lat,   d.lon AS dest_lon,

    -- congestion
    dd.origin_dep_density,
    ad.dest_arr_density,

    -- delay history, train period only
    rr.route_delay_rate,
    ohr.origin_hour_delay_rate,
    dhr.dest_hour_delay_rate,
    cr.carrier_delay_rate,

    -- weather at both ends
    ow.wind_kt       AS origin_wind_kt,
    ow.gust_kt       AS origin_gust_kt,
    ow.precip_in     AS origin_precip_in,
    ow.visibility_mi AS origin_visibility_mi,
    ow.temp_f        AS origin_temp_f,
    dw.wind_kt       AS dest_wind_kt,
    dw.gust_kt       AS dest_gust_kt,
    dw.precip_in     AS dest_precip_in,
    dw.visibility_mi AS dest_visibility_mi,
    dw.temp_f        AS dest_temp_f,


    f.arr_delay_minutes,
    f.is_delayed
FROM flights f
JOIN airports o ON o.iata = f.origin
JOIN airports d ON d.iata = f.dest
LEFT JOIN holidays h ON h.holiday = f.flight_date
LEFT JOIN dep_density dd
       ON dd.origin = f.origin
      AND dd.local_hour = date_trunc('hour', f.sched_dep_local)
LEFT JOIN arr_density ad
       ON ad.dest = f.dest
      AND ad.local_hour = date_trunc('hour', f.sched_arr_local)
LEFT JOIN route_rates rr       ON rr.origin = f.origin AND rr.dest = f.dest
LEFT JOIN origin_hour_rates ohr ON ohr.origin = f.origin AND ohr.hour_of_day = f.dep_hour
LEFT JOIN dest_hour_rates dhr   ON dhr.dest = f.dest     AND dhr.hour_of_day = f.arr_hour
LEFT JOIN carrier_rates cr      ON cr.carrier = f.carrier
LEFT JOIN weather ow
       ON ow.station = f.origin
      AND ow.local_hour = date_trunc('hour', f.sched_dep_local)
LEFT JOIN weather dw
       ON dw.station = f.dest
      AND dw.local_hour = date_trunc('hour', f.sched_arr_local);

-- Total ordering, not decoration. run_sql.py disables insertion order, so
-- ties here reach LightGBM's bagging and two identical runs train different
-- models. arr_hour is in the list because ~48 flights/year match on everything
-- else and kept swapping.
COPY (
    SELECT * FROM features
    ORDER BY sched_dep_local, origin, dest, carrier, arr_hour, arr_delay_minutes
)
TO 'data/processed/features.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
