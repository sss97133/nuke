
/**
 * Quantum Visualization Calculations
 * 
 * This file serves as the central export point for all quantum calculation functions
 * used in the skill visualization system.
 */

// Career and momentum calculations
import { calculateCareerMomentum } from './careerMomentum';

// Quantum physics simulation calculations
import { calculateQuantumState } from './quantumState';
import { calculateSuperpositionState } from './superpositionState';
import { calculateProbabilityDensity } from './probabilityDensity';
import { calculateQuantumEntanglement } from './quantumEntanglement';
import { calculateSkillInteraction } from './skillInteraction';

// Group calculations by their purpose for cleaner imports
export const QuantumCalculations = {
  // Career-related calculations
  Career: {
    calculateMomentum: calculateCareerMomentum
  },
  
  // Quantum physics simulation calculations
  Physics: {
    calculateQuantumState,
    calculateSuperpositionState,
    calculateProbabilityDensity,
    calculateQuantumEntanglement,
    calculateSkillInteraction
  }
};

// Also export individual functions for backward compatibility
export {
  calculateCareerMomentum,
  calculateQuantumState,
  calculateSuperpositionState,
  calculateProbabilityDensity,
  calculateQuantumEntanglement,
  calculateSkillInteraction
};
