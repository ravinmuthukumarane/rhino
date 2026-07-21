FROM timescale/timescaledb:latest-pg16
COPY schema.sql /docker-entrypoint-initdb.d/01_schema.sql
COPY timescale.sql /docker-entrypoint-initdb.d/02_timescale.sql
COPY seed.sql /docker-entrypoint-initdb.d/03_seed.sql
