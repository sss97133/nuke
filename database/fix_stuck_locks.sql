-- Clear stuck worker locks
UPDATE import_queue
SET worker_id = NULL
WHERE status = 'pending' AND worker_id IS NOT NULL;

-- Reset failed items with recoverable errors to pending
UPDATE import_queue
SET status = 'pending', attempts = 0, worker_id = NULL, error_message = NULL
WHERE status = 'failed'
AND (
  error_message LIKE '%duplicate key value violates unique constraint "vehicles_vin_unique_index"%'
  OR error_message LIKE '%is out of range for type integer%'
);
