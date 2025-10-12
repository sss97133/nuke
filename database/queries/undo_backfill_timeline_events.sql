-- UNDO: Delete all timeline events created by the backfill migration
-- This will remove only the events we just created

-- First, check how many events will be deleted
SELECT 
    'Events to be deleted' as action,
    COUNT(*) as count
FROM timeline_events 
WHERE source = 'backfill_migration'
AND metadata->>'source' = 'backfill_sql';

-- Delete all timeline events created by the backfill
DELETE FROM timeline_events 
WHERE source = 'backfill_migration'
AND metadata->>'source' = 'backfill_sql';

-- Verify deletion
SELECT 
    'After deletion' as action,
    COUNT(*) as remaining_backfill_events
FROM timeline_events 
WHERE source = 'backfill_migration'
AND metadata->>'source' = 'backfill_sql';

-- Show remaining timeline events by source
SELECT 
    source,
    COUNT(*) as count
FROM timeline_events 
GROUP BY source
ORDER BY count DESC;
