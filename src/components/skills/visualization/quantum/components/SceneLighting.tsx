
import React from 'react';
import * as THREE from 'three';

interface SceneLightingProps {
  scene: THREE.Scene;
}

const SceneLighting: React.FC<SceneLightingProps> = ({ scene }) => {
  // Component no longer adds any lighting effects
  // It's kept as a placeholder in case lighting needs to be added back in the future
  return null;
};

export default SceneLighting;
