import type { Database } from '../types';
import { supabase } from '@/lib/supabase';
import type { 
  Skill, 
  Contribution, 
  SkillProgress, 
  ContributionType, 
  ContributionStatus,
  SkillLevel 
} from '@/types/skills';

export const skillsService = {
  // Skills
  async getSkills(): Promise<Skill[]> {
    const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
      .from('skills')
      .select('*')
      .order('name');
    
    if (error) throw error;
    return data;
  },

  async getSkillById(id: string): Promise<Skill> {
    const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
      
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  },

  async createSkill(skill: Omit<Skill, 'id' | 'created_at' | 'updated_at'>): Promise<Skill> {
    const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
      
      .insert([skill])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Contributions
  async getContributions(): Promise<Contribution[]> {
    const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
      
      .select(`
        *,
        vehicle_contributions(vehicle_id),
        project_contributions(project_id),
        contribution_skills(skill_id, proficiency_level)
      `)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data.map(contribution => ({
      ...contribution,
      vehicles: contribution.vehicle_contributions?.map(vc => vc.vehicle_id) || [],
      projects: contribution.project_contributions?.map(pc => pc.project_id) || [],
      skills: contribution.contribution_skills || []
    }));
  },

  async getContributionsByVehicle(vehicleId: string): Promise<Contribution[]> {
    const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
      .from('contributions')
      .select(`
        *,
        vehicle_contributions!inner(vehicle_id),
        contribution_skills(skill_id, proficiency_level)
      `)
      .eq('vehicle_contributions.vehicle_id', vehicleId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data.map(contribution => ({
      ...contribution,
      skills: contribution.contribution_skills || []
    }));
  },

  async createContribution(contribution: Omit<Contribution, 'id' | 'created_at' | 'updated_at'>): Promise<Contribution> {
    const { vehicles, projects, skills, ...contributionData } = contribution;

    // Start a transaction
    const { data, error } = await supabase.rpc('create_contribution', {
  if (error) console.error("Database query error:", error);
      contribution_data: contributionData,
      vehicle_ids: vehicles || [],
      project_ids: projects || [],
      skill_data: skills || []
    });

    if (error) throw error;
    return data;
  },

  // Skill Progress
  async getSkillProgress(skillId: string): Promise<SkillProgress> {
    const { data, error } = await supabase.rpc('get_skill_progress', {
  if (error) console.error("Database query error:", error);
      skill_id: skillId
    });

    if (error) throw error;
    return data;
  },

  async getUserSkillProgress(userId: string): Promise<SkillProgress[]> {
    const { data, error } = await supabase.rpc('get_user_skill_progress', {
  if (error) console.error("Database query error:", error);
      user_id: userId
    });

    if (error) throw error;
    return data;
  }
}; 