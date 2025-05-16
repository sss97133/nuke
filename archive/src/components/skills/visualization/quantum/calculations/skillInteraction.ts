
import { UserSkill } from '@/types/skills';

/**
 * Calculates interaction strength between skills
 * Skills with similar levels have stronger interactions
 */
export const calculateSkillInteraction = (skill1: UserSkill, skill2: UserSkill) => {
  if (!skill1 || !skill2) return 0;
  
  // Different skills in same category interact more
  const levelDiff = Math.abs(skill1.level - skill2.level);
  const xpCorrelation = Math.abs(skill1.experience_points - skill2.experience_points) / 5000;
  
  // Exponential decay for smoother falloff of interaction
  const interactionStrength = Math.exp(-(levelDiff + xpCorrelation));
  
  // Scale the interaction strength
  return interactionStrength * 0.015;
};
