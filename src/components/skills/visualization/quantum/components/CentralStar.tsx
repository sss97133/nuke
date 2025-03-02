
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';

interface CentralStarProps {
  scene: THREE.Scene;
}

const CentralStar: React.FC<CentralStarProps> = ({ scene }) => {
  const centralSphereRef = useRef<THREE.Mesh | null>(null);
  const glowSphereRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    if (!scene) return;
    
    // Add central star effect
    const centralGeometry = new THREE.SphereGeometry(2, 32, 32);
    const centralMaterial = new THREE.MeshPhongMaterial({
      color: 0x0088ff,
      emissive: 0x0044aa,
      transparent: true,
      opacity: 0.8
    });
    const centralSphere = new THREE.Mesh(centralGeometry, centralMaterial);
    centralSphereRef.current = centralSphere;
    scene.add(centralSphere);
    
    // Add glow effect
    const glowGeometry = new THREE.SphereGeometry(2.5, 32, 32);
    const glowMaterial = new THREE.MeshPhongMaterial({
      color: 0x0088ff,
      emissive: 0x0066cc,
      transparent: true,
      opacity: 0.3
    });
    const glowSphere = new THREE.Mesh(glowGeometry, glowMaterial);
    glowSphereRef.current = glowSphere;
    scene.add(glowSphere);
    
    return () => {
      if (centralSphereRef.current) {
        scene.remove(centralSphereRef.current);
        centralSphereRef.current.geometry.dispose();
        (centralSphereRef.current.material as THREE.Material).dispose();
      }
      
      if (glowSphereRef.current) {
        scene.remove(glowSphereRef.current);
        glowSphereRef.current.geometry.dispose();
        (glowSphereRef.current.material as THREE.Material).dispose();
      }
    };
  }, [scene]);

  // Animation function to be called in the main component's animation loop
  const animate = () => {
    if (centralSphereRef.current) {
      centralSphereRef.current.rotation.y += 0.005;
    }
    
    if (glowSphereRef.current) {
      glowSphereRef.current.rotation.y -= 0.003;
      
      // Pulse effect
      const time = Date.now() * 0.001;
      const pulseScale = 1 + 0.05 * Math.sin(time * 0.5);
      glowSphereRef.current.scale.set(pulseScale, pulseScale, pulseScale);
    }
  };

  return { animate };
};

export default CentralStar;
