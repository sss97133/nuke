
import { UserSkill } from '@/types/skills';

/**
 * Calculate quantum entanglement between skills
 * Skills with prerequisites have stronger entanglement
 */
export const calculateQuantumEntanglement = (
  skillId1: string, 
  skillId2: string, 
  prerequisites: Record<string, string[]>,
  userSkills: UserSkill[]
) => {
  // Base entanglement
  let entanglement = 0;
  
  // Check if skills are directly related through prerequisites
  const skill1Prerequisites = prerequisites[skillId1] || [];
  const skill2Prerequisites = prerequisites[skillId2] || [];
  
  // Direct prerequisite relationship
  if (skill1Prerequisites.includes(skillId2) || skill2Prerequisites.includes(skillId1)) {
    entanglement += 0.8;
  }
  
  // Shared prerequisites indicate relationship
  const sharedPrerequisites = skill1Prerequisites.filter(p => skill2Prerequisites.includes(p));
  entanglement += sharedPrerequisites.length * 0.2;
  
  // Skill level influences entanglement strength
  const userSkill1 = userSkills.find(us => us.skill_id === skillId1);
  const userSkill2 = userSkills.find(us => us.skill_id === skillId2);
  
  if (userSkill1 && userSkill2) {
    // Higher combined skill levels increase entanglement
    const combinedLevel = userSkill1.level + userSkill2.level;
    entanglement *= (1 + (combinedLevel / 10));
  }
  
  return Math.min(1, entanglement);
};
