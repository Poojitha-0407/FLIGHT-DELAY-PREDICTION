-- Congestion counts + historical delay rates.
--
-- Congestion comes off the published schedule, which you know before departure,
-- so it uses the whole year. Delay rates come off outcomes, so train period only.
-- Rates are smoothed toward the global mean (k=50) or a 4-flight route shows up
-- claiming a 100% delay rate.

CREATE OR REPLACE TABLE dep_density AS
SELECT
    origin,
    date_trunc('hour', sched_dep_local) AS local_hour,
    COUNT(*) AS origin_dep_density
FROM flights
GROUP BY ALL;

CREATE OR REPLACE TABLE arr_density AS
SELECT
    dest,
    date_trunc('hour', sched_arr_local) AS local_hour,
    COUNT(*) AS dest_arr_density
FROM flights
GROUP BY ALL;

-- The API has no future schedule to count, so it falls back to these.
CREATE OR REPLACE TABLE dep_density_profile AS
SELECT
    origin,
    EXTRACT(hour FROM local_hour)::INTEGER AS hour_of_day,
    median(origin_dep_density)             AS origin_dep_density
FROM dep_density
GROUP BY ALL;

CREATE OR REPLACE TABLE arr_density_profile AS
SELECT
    dest,
    EXTRACT(hour FROM local_hour)::INTEGER AS hour_of_day,
    median(dest_arr_density)               AS dest_arr_density
FROM arr_density
GROUP BY ALL;

CREATE OR REPLACE TABLE train_base AS
SELECT * FROM flights WHERE split = 'train';

CREATE OR REPLACE TABLE global_rate AS
SELECT avg(is_delayed) AS rate, 50.0 AS k FROM train_base;

CREATE OR REPLACE TABLE route_rates AS
SELECT
    f.origin,
    f.dest,
    COUNT(*) AS n,
    (SUM(f.is_delayed) + g.k * g.rate) / (COUNT(*) + g.k) AS route_delay_rate
FROM train_base f CROSS JOIN global_rate g
GROUP BY f.origin, f.dest, g.k, g.rate;

CREATE OR REPLACE TABLE origin_hour_rates AS
SELECT
    f.origin,
    f.dep_hour AS hour_of_day,
    COUNT(*) AS n,
    (SUM(f.is_delayed) + g.k * g.rate) / (COUNT(*) + g.k) AS origin_hour_delay_rate
FROM train_base f CROSS JOIN global_rate g
GROUP BY f.origin, f.dep_hour, g.k, g.rate;

CREATE OR REPLACE TABLE dest_hour_rates AS
SELECT
    f.dest,
    f.arr_hour AS hour_of_day,
    COUNT(*) AS n,
    (SUM(f.is_delayed) + g.k * g.rate) / (COUNT(*) + g.k) AS dest_hour_delay_rate
FROM train_base f CROSS JOIN global_rate g
GROUP BY f.dest, f.arr_hour, g.k, g.rate;

CREATE OR REPLACE TABLE carrier_rates AS
SELECT
    f.carrier,
    COUNT(*) AS n,
    (SUM(f.is_delayed) + g.k * g.rate) / (COUNT(*) + g.k) AS carrier_delay_rate
FROM train_base f CROSS JOIN global_rate g
GROUP BY f.carrier, g.k, g.rate;

DROP TABLE train_base;
