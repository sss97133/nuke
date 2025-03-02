
import { UserSkill } from '@/types/skills';

/**
 * Calculates the rotation momentum based on skills
 * Higher skills produce faster momentum with smooth fluctuations
 */
export const calculateCareerMomentum = (userSkills: UserSkill[]) => {
  if (!userSkills || userSkills.length === 0) return 0.001;
  
  // Calculate total XP and average level
  const totalXP = userSkills.reduce((sum, skill) => sum + skill.experience_points, 0);
  const totalSkills = userSkills.length;
  const avgLevel = userSkills.reduce((sum, skill) => sum + skill.level, 0) / totalSkills;
  
  // Base momentum increases with skill level and XP
  const baseMomentum = (totalXP / (10000 * totalSkills)) * 0.002;
  
  // Add wave fluctuation for more organic movement
  const waveFactor = Math.sin(Date.now() * 0.0005) * 0.0005;
  
  // Apply skill level factor - higher skills = smoother, more controlled rotation
  const levelFactor = Math.min(1, avgLevel / 5);
  const stabilityFactor = 0.5 + (levelFactor * 0.5);
  
  // Calculate final momentum with constraints
  return Math.min(0.006, Math.max(0.0005, baseMomentum * stabilityFactor + waveFactor));
};
