-- Enable RLS on all tables
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_contributions ENABLE ROW LEVEL SECURITY;

-- Create skills table
CREATE TABLE IF NOT EXISTS skills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  category TEXT,
  level TEXT CHECK (level IN ('beginner', 'intermediate', 'advanced', 'expert')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create contributions table
CREATE TABLE IF NOT EXISTS contributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  contribution_type TEXT CHECK (contribution_type IN ('repair', 'maintenance', 'modification', 'restoration', 'documentation')),
  status TEXT CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  start_date DATE,
  end_date DATE,
  hours_spent DECIMAL(5,2),
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create vehicle_contributions junction table
CREATE TABLE IF NOT EXISTS vehicle_contributions (
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  contribution_id UUID REFERENCES contributions(id) ON DELETE CASCADE,
  PRIMARY KEY (vehicle_id, contribution_id)
);

-- Create project_contributions junction table
CREATE TABLE IF NOT EXISTS project_contributions (
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  contribution_id UUID REFERENCES contributions(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, contribution_id)
);

-- Create contribution_skills junction table
CREATE TABLE IF NOT EXISTS contribution_skills (
  contribution_id UUID REFERENCES contributions(id) ON DELETE CASCADE,
  skill_id UUID REFERENCES skills(id) ON DELETE CASCADE,
  proficiency_level TEXT CHECK (proficiency_level IN ('beginner', 'intermediate', 'advanced', 'expert')),
  PRIMARY KEY (contribution_id, skill_id)
);

-- Create RLS policies for skills
CREATE POLICY "Allow authenticated users to view skills"
ON skills FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Allow authenticated users to insert skills"
ON skills FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update skills"
ON skills FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Create RLS policies for contributions
CREATE POLICY "Allow users to view their own contributions"
ON contributions FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Allow users to insert their own contributions"
ON contributions FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow users to update their own contributions"
ON contributions FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow users to delete their own contributions"
ON contributions FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Create RLS policies for vehicle_contributions
CREATE POLICY "Allow users to view vehicle contributions"
ON vehicle_contributions FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Allow users to insert vehicle contributions"
ON vehicle_contributions FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Allow users to delete vehicle contributions"
ON vehicle_contributions FOR DELETE
TO authenticated
USING (true);

-- Create RLS policies for project_contributions
CREATE POLICY "Allow users to view project contributions"
ON project_contributions FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Allow users to insert project contributions"
ON project_contributions FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Allow users to delete project contributions"
ON project_contributions FOR DELETE
TO authenticated
USING (true);

-- Create RLS policies for contribution_skills
CREATE POLICY "Allow users to view contribution skills"
ON contribution_skills FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Allow users to insert contribution skills"
ON contribution_skills FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Allow users to delete contribution skills"
ON contribution_skills FOR DELETE
TO authenticated
USING (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_skills_updated_at
  BEFORE UPDATE ON skills
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contributions_updated_at
  BEFORE UPDATE ON contributions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column(); 