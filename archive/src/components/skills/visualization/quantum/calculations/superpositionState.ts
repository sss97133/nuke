
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
