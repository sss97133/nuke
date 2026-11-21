-- Never applied. Both deploy attempts (2026-11-21 04:55Z and 04:56Z) hit the 5 s lock timeout on the foreign key from
-- user_consents.vehicle_id to vehicles and rolled back whole. Superseded by 20261121060000_vehicle_agent_sessions.sql,
-- which is the same change without that foreign key. This file is kept as a no-op so the version stays taken.
SELECT 1;
