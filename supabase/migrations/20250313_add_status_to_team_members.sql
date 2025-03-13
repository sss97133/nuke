-- Add status column to team_members table
ALTER TABLE IF EXISTS public.team_members ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- Update any existing records to have 'active' status
UPDATE public.team_members SET status = 'active' WHERE status IS NULL;

-- Add comment on the column
COMMENT ON COLUMN public.team_members.status IS 'Status of the team member (active, inactive, etc.)';
