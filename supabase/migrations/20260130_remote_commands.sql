CREATE TABLE IF NOT EXISTS remote_commands (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  machine_id text NOT NULL DEFAULT 'portable-1',
  command text NOT NULL,
  status text DEFAULT 'pending',
  output text,
  error text,
  created_at timestamptz DEFAULT now(),
  executed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_remote_commands_pending
ON remote_commands(machine_id, status) WHERE status = 'pending';
