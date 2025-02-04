import React from 'react';
import * as THREE from 'three';

interface FixedCamerasProps {
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  cameras: {
    frontWall: boolean;
    backWall: boolean;
    leftWall: boolean;
    rightWall: boolean;
    ceiling: boolean;
    showCone: boolean;
  };
  scene: THREE.Scene;
}

export const createFixedCameras = ({ dimensions, cameras, scene }: FixedCamerasProps) => {
  const cameraGroups: THREE.Group[] = [];

  const createCamera = (position: THREE.Vector3, lookAt: THREE.Vector3) => {
    const cameraGroup = new THREE.Group();
    
    // Camera body
    const cameraBody = new THREE.BoxGeometry(0.5, 0.5, 0.8);
    const cameraMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
    const cameraMesh = new THREE.Mesh(cameraBody, cameraMaterial);
    cameraGroup.add(cameraMesh);
    
    // Camera cone
    if (cameras.showCone) {
      const coneHeight = dimensions.length / 4;
      const coneGeometry = new THREE.ConeGeometry(
        Math.tan((45 * Math.PI) / 180) * coneHeight,
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
      cameraGroup.add(cone);
    }

    cameraGroup.position.copy(position);
    cameraGroup.lookAt(lookAt);
    scene.add(cameraGroup);
    cameraGroups.push(cameraGroup);
  };

  if (cameras.frontWall) {
    createCamera(
      new THREE.Vector3(0, dimensions.height * 0.8, dimensions.length / 2),
      new THREE.Vector3(0, dimensions.height * 0.4, 0)
    );
  }
  if (cameras.backWall) {
    createCamera(
      new THREE.Vector3(0, dimensions.height * 0.8, -dimensions.length / 2),
      new THREE.Vector3(0, dimensions.height * 0.4, 0)
    );
  }
  if (cameras.leftWall) {
    createCamera(
      new THREE.Vector3(-dimensions.width / 2, dimensions.height * 0.8, 0),
      new THREE.Vector3(0, dimensions.height * 0.4, 0)
    );
  }
  if (cameras.rightWall) {
    createCamera(
      new THREE.Vector3(dimensions.width / 2, dimensions.height * 0.8, 0),
      new THREE.Vector3(0, dimensions.height * 0.4, 0)
    );
  }
  if (cameras.ceiling) {
    createCamera(
      new THREE.Vector3(0, dimensions.height, 0),
      new THREE.Vector3(0, 0, 0)
    );
  }

  return cameraGroups;
};