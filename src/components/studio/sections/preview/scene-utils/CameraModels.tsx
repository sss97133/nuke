
import * as THREE from 'three';
import type { PTZTrack } from '@/components/studio/types/workspace';

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
  const coneMeshes: THREE.Mesh[] = [];
  
  ptzTracks.forEach((track, index) => {
    const cameraGroup = new THREE.Group();
    
    // Camera body
    const cameraBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.4, 0.6),
      new THREE.MeshBasicMaterial({ 
        color: selectedCameraIndex === index ? 0xff6600 : 0x333333, 
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
    const coneLength = track.length || 10; // Default length
    const coneAngle = track.coneAngle || 45; // Default angle in degrees
    
    const fovConeMaterial = new THREE.MeshBasicMaterial({ 
      color: selectedCameraIndex === index ? 0xff9900 : 0x0088ff, 
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
    coneMeshes.push(fovCone);
    
    // Set position
    cameraGroup.position.set(
      track.position.x,
      track.position.y,
      track.position.z
    );
    
    // Look at target point
    if (track.target) {
      const targetVector = new THREE.Vector3(track.target.x, track.target.y, track.target.z);
      cameraGroup.lookAt(targetVector);
    }
    
    // Store the track index in userData for raycasting
    cameraGroup.userData = { 
      type: 'camera',
      index: index
    };
    
    scene.add(cameraGroup);
    cameraModels.push(cameraGroup);
  });
  
  return { cameraModels, coneMeshes };
};

/**
 * Updates existing camera models when ptzTracks or selection changes
 */
export const updateCameraModels = (
  cameraModels: THREE.Group[],
  coneMeshes: THREE.Mesh[],
  ptzTracks: PTZTrack[],
  selectedCameraIndex: number | null
) => {
  ptzTracks.forEach((track, index) => {
    if (index < cameraModels.length) {
      const cameraGroup = cameraModels[index];
      cameraGroup.position.set(track.position.x, track.position.y, track.position.z);
      
      // Update the FOV cone
      if (index < coneMeshes.length) {
        const cone = coneMeshes[index];
        
        // Update cone size if needed
        const coneLength = track.length || 10;
        const coneAngle = track.coneAngle || 45;
        const coneRadians = THREE.MathUtils.degToRad(coneAngle);
        const coneRadius = Math.tan(coneRadians / 2) * coneLength;
        
        // Remove old cone and create a new one with updated dimensions
        if (cone.geometry) {
          cone.geometry.dispose();
        }
        cone.geometry = new THREE.ConeGeometry(coneRadius, coneLength, 32);
        cone.position.z = coneLength / 2 + 0.3;
        
        // Update material color based on selection
        if (cone.material) {
          (cone.material as THREE.MeshBasicMaterial).color.set(
            selectedCameraIndex === index ? 0xff9900 : 0x0088ff
          );
        }
      }
      
      if (track.target) {
        const targetVector = new THREE.Vector3(track.target.x, track.target.y, track.target.z);
        cameraGroup.lookAt(targetVector);
      }
      
      // Update camera body color based on selection
      const cameraBody = cameraGroup.children[0] as THREE.Mesh;
      if (cameraBody && cameraBody.material) {
        (cameraBody.material as THREE.MeshBasicMaterial).color.set(
          selectedCameraIndex === index ? 0xff6600 : 0x333333
        );
      }
    }
  });
};
