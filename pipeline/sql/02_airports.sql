-- Airport reference data. Coordinates for the Haversine feature, IANA zone for
-- lining METAR up with BTS local time.

CREATE OR REPLACE TABLE airports AS
WITH openflights AS (
    SELECT
        col4  AS iata,
        col1  AS name,
        col2  AS city,
        col6  AS lat,
        col7  AS lon,
        col11 AS tz
    FROM read_csv(
        getvariable('airports_dat'),
        header = false,
        quote = '"',
        escape = '"',
        nullstr = '\N',
        columns = {
            'col0': 'INTEGER', 'col1': 'VARCHAR', 'col2': 'VARCHAR', 'col3': 'VARCHAR',
            'col4': 'VARCHAR', 'col5': 'VARCHAR', 'col6': 'DOUBLE',  'col7': 'DOUBLE',
            'col8': 'VARCHAR', 'col9': 'VARCHAR', 'col10': 'VARCHAR', 'col11': 'VARCHAR',
            'col12': 'VARCHAR', 'col13': 'VARCHAR'
        }
    )
)
SELECT
    t.iata,
    o.name,
    o.city,
    o.lat,
    o.lon,
    o.tz
FROM top_airports t
LEFT JOIN openflights o USING (iata);

-- Fail here rather than silently producing broken weather joins downstream.
SELECT CASE
    WHEN COUNT(*) = 0 THEN 'airports ok'
    ELSE error(
        'missing coordinates or time zone for: ' || string_agg(iata, ', ')
    )
END
FROM airports
WHERE lat IS NULL OR lon IS NULL OR tz IS NULL;
