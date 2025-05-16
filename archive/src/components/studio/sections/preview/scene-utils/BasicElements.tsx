
import * as THREE from 'three';
import type { WorkspaceDimensions } from '@/components/studio/types/workspace';

/**
 * Creates a floor based on dimensions
 */
export const createFloor = (scene: THREE.Scene, dimensions: WorkspaceDimensions) => {
  const { length, width } = dimensions;
  
  // Create floor grid
  const gridHelper = new THREE.GridHelper(Math.max(length, width), Math.max(length, width)/2, 0x888888, 0xdddddd);
  gridHelper.position.y = 0.01; // Slightly above floor to avoid z-fighting
  scene.add(gridHelper);
  
  return gridHelper;
};

/**
 * Creates walls based on dimensions
 */
export const createWalls = (scene: THREE.Scene, dimensions: WorkspaceDimensions) => {
  const { length, width, height } = dimensions;
  
  // Create wireframe material
  const wireMaterial = new THREE.LineBasicMaterial({ 
    color: 0x444444,
    linewidth: 1
  });
  
  // Floor outline
  const floorGeometry = new THREE.BufferGeometry();
  const floorVertices = new Float32Array([
    -length/2, 0, -width/2,
    length/2, 0, -width/2,
    length/2, 0, width/2,
    -length/2, 0, width/2,
    -length/2, 0, -width/2
  ]);
  floorGeometry.setAttribute('position', new THREE.BufferAttribute(floorVertices, 3));
  const floor = new THREE.Line(floorGeometry, wireMaterial);
  scene.add(floor);
  
  // Ceiling outline
  const ceilingGeometry = new THREE.BufferGeometry();
  const ceilingVertices = new Float32Array([
    -length/2, height, -width/2,
    length/2, height, -width/2,
    length/2, height, width/2,
    -length/2, height, width/2,
    -length/2, height, -width/2
  ]);
  ceilingGeometry.setAttribute('position', new THREE.BufferAttribute(ceilingVertices, 3));
  const ceiling = new THREE.Line(ceilingGeometry, wireMaterial);
  scene.add(ceiling);
  
  // Vertical edges
  const pillar1 = new THREE.BufferGeometry();
  pillar1.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -length/2, 0, -width/2, -length/2, height, -width/2
  ]), 3));
  scene.add(new THREE.Line(pillar1, wireMaterial));
  
  const pillar2 = new THREE.BufferGeometry();
  pillar2.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    length/2, 0, -width/2, length/2, height, -width/2
  ]), 3));
  scene.add(new THREE.Line(pillar2, wireMaterial));
  
  const pillar3 = new THREE.BufferGeometry();
  pillar3.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    length/2, 0, width/2, length/2, height, width/2
  ]), 3));
  scene.add(new THREE.Line(pillar3, wireMaterial));
  
  const pillar4 = new THREE.BufferGeometry();
  pillar4.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -length/2, 0, width/2, -length/2, height, width/2
  ]), 3));
  scene.add(new THREE.Line(pillar4, wireMaterial));
  
  return { floor, ceiling };
};
