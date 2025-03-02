
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

/**
 * Calculates quantum state for a skill based on level
 * Higher levels have more defined and stable quantum states
 */
export const calculateQuantumState = (skillLevel: number, time: number) => {
  // Base amplitude increases with skill level
  const amplitude = 0.3 + (skillLevel / 10);
  
  // Frequency changes with skill level - higher skills have more coherent waves
  const baseFrequency = 1 + (skillLevel * 0.2);
  
  // Add quantum uncertainty that decreases with skill level
  const uncertainty = (5 - skillLevel) * 0.05;
  const noise = Math.random() * uncertainty;
  
  // Calculate quantum wavefunction with time evolution
  const frequency = baseFrequency + (noise * Math.sin(time * 0.1));
  const waveFunction = amplitude * Math.sin(frequency * time);
  
  // Add harmonic overtones for higher skill levels
  let harmonics = 0;
  if (skillLevel > 1) {
    // Add first harmonic
    harmonics += (amplitude * 0.3) * Math.sin(frequency * 2 * time);
  }
  if (skillLevel > 3) {
    // Add second harmonic
    harmonics += (amplitude * 0.15) * Math.sin(frequency * 3 * time);
  }
  
  return waveFunction + harmonics;
};

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

/**
 * Calculate probability density function for a skill's quantum cloud
 * Based on uncertainty principle - higher level = more concentrated cloud
 */
export const calculateProbabilityDensity = (distance: number, skillLevel: number) => {
  // Higher skill levels have more concentrated probability density
  const uncertainty = 1 - (skillLevel / 10);
  const sigma = 0.5 * uncertainty;
  
  // Gaussian distribution for probability
  return Math.exp(-(distance * distance) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
};

/**
 * Calculate quantum superposition state
 * Represents skills that have multiple potential paths or applications
 */
export const calculateSuperpositionState = (
  skillLevel: number, 
  relatedSkillsCount: number, 
  time: number
) => {
  // Base factors
  const levelFactor = skillLevel / 5;
  const breadthFactor = Math.min(1, relatedSkillsCount / 10);
  
  // Calculate superposition strength
  const superpositionStrength = levelFactor * breadthFactor;
  
  // Time-dependent phase oscillation
  const phaseOscillation = Math.sin(time * (1 + levelFactor)) * Math.PI;
  
  // Return superposition vector components (can be used for visual effects)
  return {
    x: superpositionStrength * Math.cos(phaseOscillation),
    y: superpositionStrength * Math.sin(phaseOscillation),
    strength: superpositionStrength
  };
};
