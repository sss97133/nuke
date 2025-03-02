
import React, { useEffect } from 'react';
import * as THREE from 'three';
import { createVisualizationLighting } from '@/components/studio/utils/studioLighting';

interface SceneLightingProps {
  scene: THREE.Scene;
}

const SceneLighting: React.FC<SceneLightingProps> = ({ scene }) => {
  useEffect(() => {
    if (!scene) return;
    
    // Apply the visualization lighting preset
    createVisualizationLighting(scene);
    
    return () => {
      // Clean up lights on unmount
      scene.children.forEach((child) => {
        if (
          child instanceof THREE.DirectionalLight ||
          child instanceof THREE.SpotLight ||
          child instanceof THREE.PointLight ||
          child instanceof THREE.AmbientLight ||
          child instanceof THREE.HemisphereLight
        ) {
          scene.remove(child);
        }
      });
    };
  }, [scene]);
  
  return null;
};

export default SceneLighting;
