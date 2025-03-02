
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
