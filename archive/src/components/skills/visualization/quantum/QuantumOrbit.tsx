
import * as THREE from 'three';
import { SkillCategory } from '@/types/skills';

interface QuantumOrbitProps {
  category: SkillCategory;
  baseRadius: number;
  color: THREE.Color;
  scene: THREE.Scene;
}

export const createQuantumOrbit = ({ category, baseRadius, color, scene }: QuantumOrbitProps) => {
  const orbitalGeometry = new THREE.TorusGeometry(
    baseRadius,
    0.02,
    32,
    200
  );
  
  const orbitalMaterial = new THREE.MeshPhongMaterial({ 
    color: color,
    transparent: true,
    opacity: 0.3,
    emissive: color,
    emissiveIntensity: 0.2
  });
  
  const orbital = new THREE.Mesh(orbitalGeometry, orbitalMaterial);
  orbital.rotation.x = Math.PI / 2;
  scene.add(orbital);
  
  return orbital;
};
