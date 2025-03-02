
import * as THREE from 'three';
import type { WorkspaceDimensions } from '@/components/studio/types/workspace';

/**
 * Creates a wireframe room based on dimensions
 */
export const createWireframeRoom = (scene: THREE.Scene, dimensions: WorkspaceDimensions) => {
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
  
  // Floor grid
  const gridHelper = new THREE.GridHelper(Math.max(length, width), Math.max(length, width)/2, 0x888888, 0xdddddd);
  gridHelper.position.y = 0.01; // Slightly above floor to avoid z-fighting
  scene.add(gridHelper);
};

/**
 * Creates a human figure for scale reference
 */
export const createHumanFigure = () => {
  const group = new THREE.Group();
  
  // Body
  const bodyGeometry = new THREE.CylinderGeometry(0.2, 0.2, 1.2, 8);
  const bodyMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x888888,
    wireframe: true,
    wireframeLinewidth: 2
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.8;
  group.add(body);
  
  // Head
  const headGeometry = new THREE.SphereGeometry(0.2, 8, 8);
  const head = new THREE.Mesh(headGeometry, bodyMaterial);
  head.position.y = 1.6;
  group.add(head);
  
  // Legs
  const legGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.8, 8);
  
  const leftLeg = new THREE.Mesh(legGeometry, bodyMaterial);
  leftLeg.position.set(-0.1, 0.2, 0);
  group.add(leftLeg);
  
  const rightLeg = new THREE.Mesh(legGeometry, bodyMaterial);
  rightLeg.position.set(0.1, 0.2, 0);
  group.add(rightLeg);
  
  // Arms
  const armGeometry = new THREE.CylinderGeometry(0.07, 0.07, 0.8, 8);
  
  const leftArm = new THREE.Mesh(armGeometry, bodyMaterial);
  leftArm.rotation.z = Math.PI / 4;
  leftArm.position.set(-0.4, 1.0, 0);
  group.add(leftArm);
  
  const rightArm = new THREE.Mesh(armGeometry, bodyMaterial);
  rightArm.rotation.z = -Math.PI / 4;
  rightArm.position.set(0.4, 1.0, 0);
  group.add(rightArm);
  
  return group;
};

/**
 * Creates CNC tracks along walls and ceiling
 */
export const createCNCTracks = (scene: THREE.Scene, dimensions: WorkspaceDimensions) => {
  const { length, width, height } = dimensions;
  
  // Track material
  const trackMaterial = new THREE.LineBasicMaterial({ color: 0x0088ff, linewidth: 2 });
  
  // Create tracks
  // 1. Front wall track (X-axis)
  const frontTrackGeometry = new THREE.BufferGeometry();
  frontTrackGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -length/2, height * 0.75, width/2,
    length/2, height * 0.75, width/2
  ]), 3));
  const frontTrack = new THREE.Line(frontTrackGeometry, trackMaterial);
  scene.add(frontTrack);
  
  // 2. Back wall track (X-axis)
  const backTrackGeometry = new THREE.BufferGeometry();
  backTrackGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -length/2, height * 0.75, -width/2,
    length/2, height * 0.75, -width/2
  ]), 3));
  const backTrack = new THREE.Line(backTrackGeometry, trackMaterial);
  scene.add(backTrack);
  
  // 3. Left wall track (Z-axis)
  const leftTrackGeometry = new THREE.BufferGeometry();
  leftTrackGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -length/2, height * 0.75, -width/2,
    -length/2, height * 0.75, width/2
  ]), 3));
  const leftTrack = new THREE.Line(leftTrackGeometry, trackMaterial);
  scene.add(leftTrack);
  
  // 4. Right wall track (Z-axis)
  const rightTrackGeometry = new THREE.BufferGeometry();
  rightTrackGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    length/2, height * 0.75, -width/2,
    length/2, height * 0.75, width/2
  ]), 3));
  const rightTrack = new THREE.Line(rightTrackGeometry, trackMaterial);
  scene.add(rightTrack);
  
  // 5. Ceiling track (center, X-axis)
  const ceilingXTrackGeometry = new THREE.BufferGeometry();
  ceilingXTrackGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -length/2, height, 0,
    length/2, height, 0
  ]), 3));
  const ceilingXTrack = new THREE.Line(ceilingXTrackGeometry, trackMaterial);
  scene.add(ceilingXTrack);
  
  // 6. Ceiling track (center, Z-axis)
  const ceilingZTrackGeometry = new THREE.BufferGeometry();
  ceilingZTrackGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, height, -width/2,
    0, height, width/2
  ]), 3));
  const ceilingZTrack = new THREE.Line(ceilingZTrackGeometry, trackMaterial);
  scene.add(ceilingZTrack);
  
  return [frontTrack, backTrack, leftTrack, rightTrack, ceilingXTrack, ceilingZTrack];
};
