
import * as THREE from 'three';
import type { PTZTrack } from '@/components/studio/types/workspace';

/**
 * Creates a single camera model with FOV cone
 */
export const createCameraModel = (
  track: PTZTrack, 
  isSelected: boolean, 
  index: number
) => {
  const cameraGroup = new THREE.Group();
  
  // Camera body
  const cameraBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.4, 0.6),
    new THREE.MeshBasicMaterial({ 
      color: isSelected ? 0xff6600 : 0x333333, 
      wireframe: true 
    })
  );
  cameraGroup.add(cameraBody);
  
  // Camera lens
  const cameraLens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.3, 16),
    new THREE.MeshBasicMaterial({ color: 0x111111, wireframe: true })
  );
  cameraLens.rotation.x = Math.PI / 2;
  cameraLens.position.z = 0.45;
  cameraGroup.add(cameraLens);
  
  // Create the field of view cone
  const coneLength = Number(track.length) || 10; // Default length
  const coneAngle = Number(track.coneAngle) || 45; // Default angle in degrees
  
  const fovConeMaterial = new THREE.MeshBasicMaterial({ 
    color: isSelected ? 0xff9900 : 0x0088ff, 
    transparent: true, 
    opacity: 0.2,
    wireframe: true
  });
  
  // Convert degrees to radians
  const coneRadians = THREE.MathUtils.degToRad(coneAngle);
  
  // Calculate cone radius based on angle and length
  const coneRadius = Math.tan(coneRadians / 2) * coneLength;
  
  const fovConeGeometry = new THREE.ConeGeometry(coneRadius, coneLength, 32);
  const fovCone = new THREE.Mesh(fovConeGeometry, fovConeMaterial);
  
  // Rotate cone to point forward
  fovCone.rotation.x = Math.PI / 2;
  fovCone.position.z = coneLength / 2 + 0.3; // Position in front of camera
  
  cameraGroup.add(fovCone);
  
  // Set position
  cameraGroup.position.set(
    Number(track.position.x),
    Number(track.position.y),
    Number(track.position.z)
  );
  
  // Look at target point
  if (track.target) {
    const targetVector = new THREE.Vector3(
      Number(track.target.x), 
      Number(track.target.y), 
      Number(track.target.z)
    );
    cameraGroup.lookAt(targetVector);
  }
  
  // Store the track index in userData for raycasting
  cameraGroup.userData = { 
    type: 'camera',
    index: index
  };
  
  return cameraGroup;
};

/**
 * Creates camera models with FOV cones for each PTZ track
 */
export const createCameraModels = (
  scene: THREE.Scene, 
  ptzTracks: PTZTrack[], 
  selectedCameraIndex: number | null,
  onCameraSelect: (index: number) => void
) => {
  const cameraModels: THREE.Group[] = [];
  
  ptzTracks.forEach((track, index) => {
    const cameraGroup = createCameraModel(track, selectedCameraIndex === index, index);
    scene.add(cameraGroup);
    cameraModels.push(cameraGroup);
  });
  
  return cameraModels;
};
