
import * as THREE from 'three';
import { Skill, UserSkill } from '@/types/skills';
import { createQuantumCloud } from './QuantumCloud';

interface SkillParticleProps {
  skill: Skill;
  userSkill: UserSkill | undefined;
  angle: number;
  orbitRadius: number;
  color: THREE.Color;
  skillObjectsRef: React.RefObject<THREE.Group>;
}

/**
 * Creates an individual skill particle and adds it to the scene
 */
export const createSkillParticle = ({
  skill,
  userSkill,
  angle,
  orbitRadius,
  color,
  skillObjectsRef
}: SkillParticleProps) => {
  const skillLevel = userSkill?.level || 0;
  
  // Position around orbit
  const x = orbitRadius * Math.cos(angle);
  const z = orbitRadius * Math.sin(angle);
  
  // Create particle size based on skill level
  const particleSize = 0.3 + (skillLevel * 0.15);
  const particleGeometry = new THREE.SphereGeometry(particleSize, 16, 16);
  
  // Color based on level
  const particleColor = new THREE.Color(color);
  if (skillLevel > 0) {
    // Brighten based on level
    particleColor.r = Math.min(1, particleColor.r + skillLevel * 0.06);
    particleColor.g = Math.min(1, particleColor.g + skillLevel * 0.06);
    particleColor.b = Math.min(1, particleColor.b + skillLevel * 0.06);
  }
  
  const particleMaterial = new THREE.MeshPhongMaterial({
    color: particleColor,
    emissive: skillLevel > 0 ? particleColor.clone().multiplyScalar(0.3) : 0x000000,
    transparent: true,
    opacity: 0.8
  });
  
  const particle = new THREE.Mesh(particleGeometry, particleMaterial);
  
  // Create a group for the particle
  const skillGroup = new THREE.Group();
  skillGroup.add(particle);
  skillGroup.position.set(x, 0, z);
  skillGroup.userData = { 
    skillId: skill.id,
    skillName: skill.name,
    skillLevel: skillLevel,
    category: skill.category
  };
  
  // Add quantum cloud if skill level > 0
  if (skillLevel > 0) {
    createQuantumCloud(skillLevel, particleSize, particleColor, skillGroup);
  }
  
  if (skillObjectsRef.current) {
    skillObjectsRef.current.add(skillGroup);
  }
  
  return skillGroup;
};
