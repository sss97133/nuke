
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';

interface CentralStarProps {
  scene: THREE.Scene;
  id?: string; // Add optional id prop
}

// Define an animation handler interface to maintain type safety
export interface AnimationHandler {
  animate: () => void;
}

const CentralStar: React.FC<CentralStarProps> = ({ scene, id }) => {
  const centralSphereRef = useRef<THREE.Mesh | null>(null);
  const glowSphereRef = useRef<THREE.Mesh | null>(null);
  
  // Instantiate objects that will store our animation logic
  const animationRef = useRef({
    animate: () => {
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
    }
  });

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

  // We use a trick to expose the animate function while still being a valid React component
  return (
    <div 
      id={id} // Use the id prop if provided
      ref={(el) => {
        // This exposes our animate function to parent components that have a ref to this component
        if (el && 'animate' in animationRef.current) {
          (el as any).animate = animationRef.current.animate;
        }
      }} 
      style={{ display: 'none' }} 
    />
  );
};

// Properly define the static method with TypeScript
const CentralStarWithHandler = CentralStar as typeof CentralStar & {
  getAnimationHandler: (props: CentralStarProps) => AnimationHandler;
};

// Implement the static method
CentralStarWithHandler.getAnimationHandler = (props: CentralStarProps): AnimationHandler => {
  return {
    animate: () => {
      // This is a placeholder - in real usage, we'd access the DOM element
      console.log("Animating central star");
    }
  };
};

export default CentralStarWithHandler;
