-- Dashboard summaries. Full year -- these are reporting, not model inputs.
-- Small enough to ship to the API as JSON.

CREATE OR REPLACE TABLE agg_routes AS
WITH disruption AS (
    SELECT origin, dest,
           SUM(CASE WHEN was_cancelled THEN 1 ELSE 0 END) AS cancelled,
           SUM(CASE WHEN was_diverted  THEN 1 ELSE 0 END) AS diverted
    FROM flight_disruptions
    GROUP BY ALL
),
completed AS (
    SELECT
        origin,
        dest,
        COUNT(*)                                          AS flights,
        round(avg(is_delayed), 4)                         AS delay_rate,
        round(avg(arr_delay_minutes), 2)                  AS avg_delay_min,
        round(quantile_cont(arr_delay_minutes, 0.9), 1)   AS p90_delay_min
    FROM flights
    GROUP BY ALL
    HAVING COUNT(*) >= 100
)
SELECT
    c.origin,
    c.dest,
    o.name AS origin_name, o.city AS origin_city, o.lat AS origin_lat, o.lon AS origin_lon,
    d.name AS dest_name,   d.city AS dest_city,   d.lat AS dest_lat,   d.lon AS dest_lon,
    c.flights,
    c.delay_rate,
    c.avg_delay_min,
    c.p90_delay_min,
    round(2 * 6371.0 * asin(sqrt(
        pow(sin(radians(d.lat - o.lat) / 2), 2)
        + cos(radians(o.lat)) * cos(radians(d.lat))
          * pow(sin(radians(d.lon - o.lon) / 2), 2))), 1) AS distance_km,
    COALESCE(x.cancelled, 0)                              AS cancelled,
    round(COALESCE(x.cancelled, 0) / (c.flights + COALESCE(x.cancelled, 0)), 4) AS cancel_rate
FROM completed c
JOIN airports o ON o.iata = c.origin
JOIN airports d ON d.iata = c.dest
LEFT JOIN disruption x ON x.origin = c.origin AND x.dest = c.dest;

CREATE OR REPLACE TABLE agg_airports AS
WITH departures AS (
    SELECT origin AS iata,
           COUNT(*) AS departures,
           avg(is_delayed) AS dep_delay_rate,
           avg(arr_delay_minutes) AS avg_delay_min
    FROM flights GROUP BY ALL
),
arrivals AS (
    SELECT dest AS iata, COUNT(*) AS arrivals, avg(is_delayed) AS arr_delay_rate
    FROM flights GROUP BY ALL
),
peak AS (
    SELECT origin AS iata, max(origin_dep_density) AS peak_hourly_departures
    FROM dep_density GROUP BY ALL
)
SELECT
    a.iata, a.name, a.city, a.lat, a.lon, a.tz,
    dp.departures,
    ar.arrivals,
    round(dp.dep_delay_rate, 4)  AS dep_delay_rate,
    round(ar.arr_delay_rate, 4)  AS arr_delay_rate,
    round(dp.avg_delay_min, 2)   AS avg_delay_min,
    pk.peak_hourly_departures
FROM airports a
LEFT JOIN departures dp ON dp.iata = a.iata
LEFT JOIN arrivals   ar ON ar.iata = a.iata
LEFT JOIN peak       pk ON pk.iata = a.iata;

CREATE OR REPLACE TABLE agg_airport_hours AS
SELECT
    origin AS iata,
    dep_hour AS hour_of_day,
    COUNT(*) AS flights,
    round(avg(is_delayed), 4) AS delay_rate,
    round(avg(arr_delay_minutes), 2) AS avg_delay_min
FROM flights
GROUP BY ALL
ORDER BY iata, hour_of_day;

CREATE OR REPLACE TABLE agg_carriers AS
SELECT
    carrier,
    COUNT(*) AS flights,
    round(avg(is_delayed), 4) AS delay_rate,
    round(avg(arr_delay_minutes), 2) AS avg_delay_min
FROM flights
GROUP BY ALL
ORDER BY flights DESC;

CREATE OR REPLACE TABLE agg_monthly AS
SELECT
    month,
    COUNT(*) AS flights,
    round(avg(is_delayed), 4) AS delay_rate,
    round(avg(arr_delay_minutes), 2) AS avg_delay_min
FROM flights
GROUP BY ALL
ORDER BY month;
