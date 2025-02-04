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

  const createCamera = (position: THREE.Vector3, lookAt: THREE.Vector3, wallNormal: THREE.Vector3) => {
    const cameraGroup = new THREE.Group();
    
    // Camera body
    const cameraBody = new THREE.BoxGeometry(0.5, 0.5, 0.8);
    const cameraMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
    const cameraMesh = new THREE.Mesh(cameraBody, cameraMaterial);
    cameraGroup.add(cameraMesh);
    
    // Camera cone
    if (cameras.showCone) {
      const coneHeight = Math.min(dimensions.length, dimensions.width) / 4;
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
      
      // Align cone with wall normal
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wallNormal);
      cone.setRotationFromQuaternion(quaternion);
      
      cameraGroup.add(cone);
    }

    cameraGroup.position.copy(position);
    cameraGroup.lookAt(lookAt);
    
    // Ensure camera and cone stay within room bounds
    const box = new THREE.Box3().setFromObject(cameraGroup);
    const size = new THREE.Vector3();
    box.getSize(size);
    
    scene.add(cameraGroup);
    cameraGroups.push(cameraGroup);
  };

  // Front wall camera
  if (cameras.frontWall) {
    createCamera(
      new THREE.Vector3(0, dimensions.height * 0.8, dimensions.length / 2 - 0.5),
      new THREE.Vector3(0, dimensions.height * 0.4, 0),
      new THREE.Vector3(0, 0, -1)
    );
  }

  // Back wall camera
  if (cameras.backWall) {
    createCamera(
      new THREE.Vector3(0, dimensions.height * 0.8, -dimensions.length / 2 + 0.5),
      new THREE.Vector3(0, dimensions.height * 0.4, 0),
      new THREE.Vector3(0, 0, 1)
    );
  }

  // Left wall camera
  if (cameras.leftWall) {
    createCamera(
      new THREE.Vector3(-dimensions.width / 2 + 0.5, dimensions.height * 0.8, 0),
      new THREE.Vector3(0, dimensions.height * 0.4, 0),
      new THREE.Vector3(1, 0, 0)
    );
  }

  // Right wall camera
  if (cameras.rightWall) {
    createCamera(
      new THREE.Vector3(dimensions.width / 2 - 0.5, dimensions.height * 0.8, 0),
      new THREE.Vector3(0, dimensions.height * 0.4, 0),
      new THREE.Vector3(-1, 0, 0)
    );
  }

  // Ceiling camera
  if (cameras.ceiling) {
    createCamera(
      new THREE.Vector3(0, dimensions.height - 0.5, 0),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -1, 0)
    );
  }

  return cameraGroups;
};