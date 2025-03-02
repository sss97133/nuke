
import * as THREE from 'three';
import { calculateProbabilityDensity } from '../calculations';

/**
 * Creates a quantum cloud particle effect around a skill
 */
export const createQuantumCloud = (
  skillLevel: number, 
  particleSize: number, 
  particleColor: THREE.Color, 
  skillGroup: THREE.Group
) => {
  const cloudCount = Math.max(5, skillLevel * 10);
  const cloudGeometry = new THREE.BufferGeometry();
  const cloudVertices = [];
  const cloudColors = [];
  
  for (let i = 0; i < cloudCount; i++) {
    // Use probability density function to distribute particles
    const distance = (Math.random() - 0.5) * 2;
    const density = calculateProbabilityDensity(distance, skillLevel);
    const radius = particleSize * (1 + density * 2);
    
    const cloudTheta = Math.random() * Math.PI * 2;
    const cloudPhi = Math.random() * Math.PI;
    
    const cloudX = radius * Math.sin(cloudPhi) * Math.cos(cloudTheta);
    const cloudY = radius * Math.sin(cloudPhi) * Math.sin(cloudTheta);
    const cloudZ = radius * Math.cos(cloudPhi);
    
    cloudVertices.push(cloudX, cloudY, cloudZ);
    
    // Color with some variation
    const colorIntensity = 0.4 + (Math.random() * 0.6);
    cloudColors.push(
      particleColor.r * colorIntensity,
      particleColor.g * colorIntensity,
      particleColor.b * colorIntensity
    );
  }
  
  cloudGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cloudVertices, 3));
  cloudGeometry.setAttribute('color', new THREE.Float32BufferAttribute(cloudColors, 3));
  
  const cloudMaterial = new THREE.PointsMaterial({
    size: 0.1,
    vertexColors: true,
    transparent: true,
    opacity: 0.7
  });
  
  const cloud = new THREE.Points(cloudGeometry, cloudMaterial);
  skillGroup.add(cloud);
  
  return cloud;
};
