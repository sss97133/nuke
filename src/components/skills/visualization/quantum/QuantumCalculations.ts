
import { UserSkill } from '@/types/skills';

export const calculateCareerMomentum = (userSkills: UserSkill[]) => {
  if (!userSkills || userSkills.length === 0) return 0.001;
  
  const totalXP = userSkills.reduce((sum, skill) => sum + skill.experience_points, 0);
  const avgLevel = userSkills.reduce((sum, skill) => sum + skill.level, 0) / userSkills.length;
  
  const waveFactor = Math.sin(Date.now() * 0.001) * 0.0005;
  const baseSpeed = (totalXP / (10000 * userSkills.length)) * 0.002;
  
  return Math.min(0.004, Math.max(0.0005, baseSpeed + waveFactor));
};

export const calculateSkillInteraction = (skill1: UserSkill, skill2: UserSkill) => {
  const levelDiff = Math.abs(skill1.level - skill2.level);
  const xpCorrelation = Math.abs(skill1.experience_points - skill2.experience_points) / 5000;
  
  return Math.exp(-(levelDiff + xpCorrelation)) * 0.015;
};

export const calculateQuantumState = (skillLevel: number, time: number) => {
  const amplitude = 0.5 + (skillLevel / 10);
  const frequency = 1 + (skillLevel * 0.2);
  return amplitude * Math.sin(frequency * time);
};
