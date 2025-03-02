
import * as THREE from 'three';
import { Skill } from '@/types/skills';
import { categoryColors } from '../QuantumColors';

interface CreateOrbitProps {
  scene: THREE.Scene;
  category: string;
  categorySkills: Skill[];
  orbitRadius: number;
  orbitLinesRef: React.MutableRefObject<THREE.Line[]>;
}

/**
 * Creates the orbital path for a category of skills
 */
export const createOrbit = ({
  scene,
  category,
  categorySkills,
  orbitRadius,
  orbitLinesRef
}: CreateOrbitProps) => {
  const color = categoryColors[category as keyof typeof categoryColors] || new THREE.Color(0xffffff);
  
  // Create orbital path
  const orbitGeometry = new THREE.BufferGeometry();
  const orbitSegments = 128;
  const orbitVertices = [];
  
  for (let i = 0; i <= orbitSegments; i++) {
    const theta = (i / orbitSegments) * Math.PI * 2;
    const x = orbitRadius * Math.cos(theta);
    const z = orbitRadius * Math.sin(theta);
    orbitVertices.push(x, 0, z);
  }
  
  orbitGeometry.setAttribute('position', new THREE.Float32BufferAttribute(orbitVertices, 3));
  
  const orbitMaterial = new THREE.LineBasicMaterial({ 
    color: color,
    transparent: true,
    opacity: 0.3
  });
  
  const orbit = new THREE.Line(orbitGeometry, orbitMaterial);
  scene.add(orbit);
  orbitLinesRef.current.push(orbit);
  
  return { orbit, color, orbitRadius };
};
