
import React, { useEffect } from 'react';
import * as THREE from 'three';

interface SceneLightingProps {
  scene: THREE.Scene;
}

const SceneLighting: React.FC<SceneLightingProps> = ({ scene }) => {
  useEffect(() => {
    if (!scene) return;
    
    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);
    
    // Add directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    
    // Add grid helper for reference
    const gridHelper = new THREE.GridHelper(50, 50, 0x222222, 0x080808);
    scene.add(gridHelper);
    
    return () => {
      scene.remove(ambientLight);
      scene.remove(directionalLight);
      scene.remove(gridHelper);
    };
  }, [scene]);

  return null;
};

export default SceneLighting;
