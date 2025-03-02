
import * as THREE from 'three';

export const createBasicStudioLighting = (scene: THREE.Scene) => {
  // Ambient light
  const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
  scene.add(ambientLight);
  
  // Main key light
  const keyLight = new THREE.DirectionalLight(0xffffff, 1);
  keyLight.position.set(10, 10, 10);
  keyLight.castShadow = true;
  
  // Configure shadow properties
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 50;
  keyLight.shadow.camera.left = -20;
  keyLight.shadow.camera.right = 20;
  keyLight.shadow.camera.top = 20;
  keyLight.shadow.camera.bottom = -20;
  
  scene.add(keyLight);
  
  // Fill light
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
  fillLight.position.set(-10, 8, 8);
  scene.add(fillLight);
  
  // Back light
  const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
  backLight.position.set(0, 8, -10);
  scene.add(backLight);
  
  return { ambientLight, keyLight, fillLight, backLight };
};

export const createProductLighting = (scene: THREE.Scene) => {
  // Clean ambient light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(ambientLight);
  
  // Bright key light
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
  keyLight.position.set(5, 10, 5);
  keyLight.castShadow = true;
  
  // Configure shadow properties
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 50;
  keyLight.shadow.camera.left = -20;
  keyLight.shadow.camera.right = 20;
  keyLight.shadow.camera.top = 20;
  keyLight.shadow.camera.bottom = -20;
  
  scene.add(keyLight);
  
  // Rim light 1
  const rimLight1 = new THREE.DirectionalLight(0xffffff, 0.6);
  rimLight1.position.set(-10, 8, 2);
  scene.add(rimLight1);
  
  // Rim light 2
  const rimLight2 = new THREE.DirectionalLight(0xffffff, 0.6);
  rimLight2.position.set(10, 8, 2);
  scene.add(rimLight2);
  
  // Bottom fill light
  const bottomFill = new THREE.DirectionalLight(0xffffff, 0.3);
  bottomFill.position.set(0, -5, 5);
  scene.add(bottomFill);
  
  return { ambientLight, keyLight, rimLight1, rimLight2, bottomFill };
};
