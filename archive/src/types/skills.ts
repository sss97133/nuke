
export type SkillCategory = 'mechanical' | 'electrical' | 'bodywork' | 'diagnostics' | 'restoration' | 'customization' | 'technical' | 'maintenance' | 'soft_skills' | 'safety';
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';
export type ContributionType = 'repair' | 'maintenance' | 'modification' | 'restoration' | 'documentation';
export type ContributionStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

export interface Skill {
  id: string;
  name: string;
  description?: string;
  category?: string;
  level?: SkillLevel;
  created_at: string;
  updated_at: string;
  prerequisites?: string[] | null;
}

export interface SkillStatus {
  level: number;
  exp: number;
  progress: number;
  isComplete: boolean;
  hasStarted: boolean;
}

export interface UserSkill {
  id: string;
  user_id: string;
  skill_id: string;
  level: number;
  experience_points: number;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Contribution {
  id: string;
  title: string;
  description?: string;
  contribution_type: ContributionType;
  status: ContributionStatus;
  start_date?: string;
  end_date?: string;
  hours_spent?: number;
  user_id: string;
  created_at: string;
  updated_at: string;
  vehicles?: string[]; // Array of vehicle IDs
  projects?: string[]; // Array of project IDs
  skills?: Array<{
    skill_id: string;
    proficiency_level: SkillLevel;
  }>;
}

export interface VehicleContribution {
  vehicle_id: string;
  contribution_id: string;
}

export interface ProjectContribution {
  project_id: string;
  contribution_id: string;
}

export interface ContributionSkill {
  contribution_id: string;
  skill_id: string;
  proficiency_level: SkillLevel;
}

export interface SkillProgress {
  skill: Skill;
  total_contributions: number;
  total_hours: number;
  average_proficiency: SkillLevel;
  recent_contributions: Contribution[];
}
