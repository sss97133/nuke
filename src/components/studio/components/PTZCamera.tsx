
import * as THREE from 'three';
import type { PTZTrack } from '../types/workspace';

export const createPTZCamera = (scene: THREE.Scene, track: PTZTrack, maxDistance: number) => {
  // Track
  const trackGeometry = new THREE.BoxGeometry(track.length, 0.2, 0.2);
  const trackMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
  const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
  trackMesh.position.set(track.position.x, track.position.y, track.position.z);
  scene.add(trackMesh);

  // PTZ Camera group
  const ptzGroup = new THREE.Group();
  
  // Camera body
  const cameraGeometry = new THREE.SphereGeometry(0.3, 8, 8);
  const cameraMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
  const cameraMesh = new THREE.Mesh(cameraGeometry, cameraMaterial);
  ptzGroup.add(cameraMesh);

  // Camera cone (field of view)
  const coneHeight = maxDistance;
  const coneRadius = Math.tan((track.coneAngle * Math.PI) / 180) * coneHeight;
  const coneGeometry = new THREE.ConeGeometry(coneRadius, coneHeight, 32);
  const coneMaterial = new THREE.MeshPhongMaterial({ 
    color: 0xff0000,
    transparent: true,
    opacity: 0.2
  });
  const cone = new THREE.Mesh(coneGeometry, coneMaterial);
  
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = coneHeight/2;
  ptzGroup.add(cone);

  ptzGroup.position.set(track.position.x, track.position.y, track.position.z);
  scene.add(ptzGroup);

  return { trackMesh, ptzGroup };
};
