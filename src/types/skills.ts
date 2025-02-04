export type SkillCategory = 'mechanical' | 'electrical' | 'bodywork' | 'diagnostics' | 'restoration' | 'customization' | 'technical' | 'maintenance' | 'soft_skills' | 'safety';

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  prerequisites?: string[];
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