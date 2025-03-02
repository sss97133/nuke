
import * as THREE from 'three';
import { UserSkill } from '@/types/skills';
import { 
  calculateCareerMomentum,
  calculateQuantumState,
  calculateSuperpositionState
} from '../calculations';

/**
 * Animates all skill particles in the scene
 */
export const animateSkills = (
  time: number,
  skillObjectsRef: React.RefObject<THREE.Group>,
  userSkills: UserSkill[]
) => {
  if (!skillObjectsRef.current) return;
  
  const momentum = calculateCareerMomentum(userSkills);
  
  // Move skill particles along orbits
  skillObjectsRef.current.children.forEach((skillGroup) => {
    if (skillGroup instanceof THREE.Group) {
      const userData = skillGroup.userData;
      const skillLevel = userData.skillLevel || 0;
      
      // Get current position (relative to center)
      const currentPos = skillGroup.position.clone();
      const orbitRadius = currentPos.length();
      
      // Calculate current angle
      let angle = Math.atan2(currentPos.z, currentPos.x);
      
      // Apply momentum and quantum state
      const quantumState = calculateQuantumState(skillLevel, time);
      const waveFactor = Math.sin(angle * 3 + time) * 0.05 * quantumState;
      
      // Update angle based on momentum and quantum effects
      angle += momentum * (1 + waveFactor) * (skillLevel > 0 ? 1 : 0.7);
      
      // Superposition effects for higher level skills
      if (skillLevel >= 3) {
        const superposition = calculateSuperpositionState(skillLevel, 5, time);
        
        // Update position with superposition effects
        skillGroup.position.x = orbitRadius * Math.cos(angle) + superposition.x * 0.2;
        skillGroup.position.z = orbitRadius * Math.sin(angle) + superposition.y * 0.2;
        
        // Add vertical oscillation based on superposition strength
        skillGroup.position.y = Math.sin(time * (1 + skillLevel * 0.1)) * superposition.strength * 0.5;
      } else {
        // Simple circular motion for lower level skills
        skillGroup.position.x = orbitRadius * Math.cos(angle);
        skillGroup.position.z = orbitRadius * Math.sin(angle);
        
        // Small vertical oscillation
        skillGroup.position.y = Math.sin(angle * 2 + time) * 0.05 * skillLevel;
      }
      
      // Skill particle rotation
      if (skillGroup.children.length > 0) {
        const particle = skillGroup.children[0];
        if (particle instanceof THREE.Mesh) {
          particle.rotation.y += 0.01 + (skillLevel * 0.005);
          particle.rotation.z += 0.005 + (skillLevel * 0.002);
        }
        
        // Quantum cloud animation
        if (skillGroup.children.length > 1) {
          const cloud = skillGroup.children[1];
          if (cloud instanceof THREE.Points) {
            cloud.rotation.x += 0.003;
            cloud.rotation.y += 0.005;
            cloud.rotation.z += 0.002;
            
            // Pulse effect based on quantum state
            const pulse = 1 + 0.1 * Math.sin(time * (1 + skillLevel * 0.2));
            cloud.scale.set(pulse, pulse, pulse);
          }
        }
      }
    }
  });
};
