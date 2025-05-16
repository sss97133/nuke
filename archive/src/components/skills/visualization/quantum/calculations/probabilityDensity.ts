
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
