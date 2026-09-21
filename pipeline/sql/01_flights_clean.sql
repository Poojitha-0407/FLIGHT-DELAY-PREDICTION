-- BTS on-time performance -> one flight-level table.
-- Completed flights between the top 30 only. Cancelled/diverted have no arrival
-- delay to predict, so they go to flight_disruptions for the dashboard instead.

CREATE OR REPLACE TABLE flights AS
WITH raw AS (
    SELECT
        TRY_CAST(FlightDate AS DATE)                AS flight_date,
        TRY_CAST(Month AS INTEGER)                  AS month,
        TRY_CAST(DayOfWeek AS INTEGER)              AS day_of_week,
        Reporting_Airline                           AS carrier,
        Origin                                      AS origin,
        Dest                                        AS dest,
        TRY_CAST(CRSDepTime AS INTEGER)             AS crs_dep_hhmm,
        TRY_CAST(CRSArrTime AS INTEGER)             AS crs_arr_hhmm,
        TRY_CAST(ArrDelayMinutes AS DOUBLE)         AS arr_delay_minutes,
        TRY_CAST(Cancelled AS DOUBLE)               AS cancelled,
        TRY_CAST(Diverted AS DOUBLE)                AS diverted
    FROM read_csv_auto(
        getvariable('bts_glob'),
        union_by_name = true,
        all_varchar = true,
        ignore_errors = true
    )
),
scoped AS (
    SELECT *
    FROM raw
    WHERE origin IN (SELECT iata FROM top_airports)
      AND dest   IN (SELECT iata FROM top_airports)
      AND origin <> dest
      AND flight_date IS NOT NULL
      AND crs_dep_hhmm IS NOT NULL
      AND crs_arr_hhmm IS NOT NULL
)
SELECT
    flight_date,
    month,
    day_of_week,
    carrier,
    origin,
    dest,
    -- HHMM local. 2400 rolls to next-day midnight on its own.
    flight_date
        + INTERVAL (crs_dep_hhmm // 100) HOUR
        + INTERVAL (crs_dep_hhmm %  100) MINUTE       AS sched_dep_local,
    -- arrival clock earlier than departure = next day (redeyes, westbound)
    flight_date
        + INTERVAL (CASE WHEN crs_arr_hhmm < crs_dep_hhmm THEN 1 ELSE 0 END) DAY
        + INTERVAL (crs_arr_hhmm // 100) HOUR
        + INTERVAL (crs_arr_hhmm %  100) MINUTE       AS sched_arr_local,
    crs_dep_hhmm // 100                               AS dep_hour,
    crs_arr_hhmm // 100                               AS arr_hour,
    arr_delay_minutes,
    CAST(arr_delay_minutes > 30 AS TINYINT)           AS is_delayed,
    CAST(cancelled  = 1 AS TINYINT)                   AS was_cancelled,
    CAST(diverted   = 1 AS TINYINT)                   AS was_diverted,
    CASE
        WHEN flight_date <  CAST(getvariable('train_end') AS DATE) THEN 'train'
        WHEN flight_date <  CAST(getvariable('valid_end') AS DATE) THEN 'valid'
        ELSE 'test'
    END                                               AS split
FROM scoped
WHERE cancelled = 0
  AND diverted = 0
  AND arr_delay_minutes IS NOT NULL;

-- Keep these so the UI doesn't need a second pass over 3 GB of CSV.
CREATE OR REPLACE TABLE flight_disruptions AS
SELECT
    CAST(FlightDate AS DATE) AS flight_date,
    Origin AS origin,
    Dest AS dest,
    Reporting_Airline AS carrier,
    TRY_CAST(Cancelled AS DOUBLE) = 1 AS was_cancelled,
    TRY_CAST(Diverted AS DOUBLE) = 1 AS was_diverted
FROM read_csv_auto(
    getvariable('bts_glob'), union_by_name = true, all_varchar = true, ignore_errors = true
)
WHERE Origin IN (SELECT iata FROM top_airports)
  AND Dest   IN (SELECT iata FROM top_airports)
  AND (TRY_CAST(Cancelled AS DOUBLE) = 1 OR TRY_CAST(Diverted AS DOUBLE) = 1);
