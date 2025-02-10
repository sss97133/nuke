
import * as THREE from 'three';
import { UserSkill } from '@/types/skills';

interface QuantumParticleProps {
  baseRadius: number;
  color: THREE.Color;
  userSkill?: UserSkill;
  scene: THREE.Scene;
}

export const createQuantumParticles = ({ baseRadius, color, userSkill, scene }: QuantumParticleProps) => {
  const level = userSkill?.level || 0;
  const particleCount = 100 + level * 50;
  const particles = new Float32Array(particleCount * 3);
  
  for (let i = 0; i < particleCount; i++) {
    const angle = (i / particleCount) * Math.PI * 2;
    const uncertaintyFactor = Math.random() * (1 / (level + 1));
    const radiusVariation = (Math.random() - 0.5) * uncertaintyFactor;
    const heightVariation = (Math.random() - 0.5) * uncertaintyFactor;
    
    particles[i * 3] = (baseRadius + radiusVariation) * Math.cos(angle);
    particles[i * 3 + 1] = heightVariation;
    particles[i * 3 + 2] = (baseRadius + radiusVariation) * Math.sin(angle);
  }

  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(particles, 3));
  
  const particleMaterial = new THREE.PointsMaterial({
    color: color,
    size: 0.05 + level * 0.02,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
  });

  const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particleSystem);
  
  return particleSystem;
};
