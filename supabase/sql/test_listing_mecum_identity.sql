-- Existing real intake/queue/reader fixture; local disposable PG17 only.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_listing_%' OR current_setting('server_version_num')::int/10000<>17 THEN
  RAISE EXCEPTION 'Disposable listing PG17 database required';
 END IF;
END $$;
\setenv PGDATABASE :DBNAME
\! NUKE_TEST_PSQL="$DB_CONTRACT_PSQL" python3 scripts/test-retained-listing-intake.py "$PGDATABASE" --two-front --bulk120 --powertrain --description --odometer --identity --vin-label --craigslist-odometer --craigslist-year --native-year --native-identity --mecum-identity
\if :SHELL_ERROR
 DO $$ BEGIN RAISE EXCEPTION 'Mecum identity source-to-reader verification failed'; END $$;
\endif
