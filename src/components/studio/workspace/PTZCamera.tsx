import React from 'react';
import * as THREE from 'three';

interface PTZCameraProps {
  track: {
    position: {
      x: number;
      y: number;
      z: number;
    };
    length: number;
    speed: number;
    coneAngle: number;
  };
  showCone: boolean;
  scene: THREE.Scene;
}

export const createPTZCamera = ({ track, showCone, scene }: PTZCameraProps) => {
  const ptzGroup = new THREE.Group();
  
  // Track
  const trackGeometry = new THREE.BoxGeometry(track.length, 0.2, 0.2);
  const trackMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
  const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
  trackMesh.position.x = track.length / 2;
  ptzGroup.add(trackMesh);
  
  // Camera body
  const cameraBody = new THREE.BoxGeometry(0.5, 0.5, 0.8);
  const cameraMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
  const cameraMesh = new THREE.Mesh(cameraBody, cameraMaterial);
  ptzGroup.add(cameraMesh);
  
  // Camera cone
  if (showCone) {
    const coneHeight = track.length / 2;
    const coneGeometry = new THREE.ConeGeometry(
      Math.tan((track.coneAngle * Math.PI) / 180) * coneHeight,
      coneHeight,
      32
    );
    const coneMaterial = new THREE.MeshPhongMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.3
    });
    const cone = new THREE.Mesh(coneGeometry, coneMaterial);
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = coneHeight / 2;
    ptzGroup.add(cone);
  }
  
  // Position PTZ camera
  ptzGroup.position.set(track.position.x, track.position.y, track.position.z);
  scene.add(ptzGroup);
  
  return ptzGroup;
};