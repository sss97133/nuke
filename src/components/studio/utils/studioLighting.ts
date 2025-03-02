
import * as THREE from 'three';

// Create basic studio lighting setup
export const createBasicStudioLighting = (scene: THREE.Scene) => {
  // Clean existing lights first
  removeExistingLights(scene);
  
  // Ambient light for overall illumination
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);
  
  // Main directional light (simulates sunlight or main studio light)
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(10, 10, 10);
  directionalLight.castShadow = true;
  
  // Configure shadow quality
  directionalLight.shadow.mapSize.width = 1024;
  directionalLight.shadow.mapSize.height = 1024;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -20;
  directionalLight.shadow.camera.right = 20;
  directionalLight.shadow.camera.top = 20;
  directionalLight.shadow.camera.bottom = -20;
  
  scene.add(directionalLight);
  
  // Secondary fill light
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(-10, 5, -10);
  scene.add(fillLight);
};

// Create product-focused lighting setup
export const createProductLighting = (scene: THREE.Scene) => {
  // Clean existing lights first
  removeExistingLights(scene);
  
  // Ambient light (lower for more dramatic shadows)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);
  
  // Key light
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
  keyLight.position.set(10, 10, 10);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 1024;
  keyLight.shadow.mapSize.height = 1024;
  scene.add(keyLight);
  
  // Fill light
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(-10, 5, -10);
  scene.add(fillLight);
  
  // Back light / rim light
  const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
  backLight.position.set(0, 10, -10);
  scene.add(backLight);
};

// Create dramatic lighting setup for visualization
export const createVisualizationLighting = (scene: THREE.Scene) => {
  // Clean existing lights first
  removeExistingLights(scene);
  
  // Soft ambient light
  const ambientLight = new THREE.AmbientLight(0x404080, 0.3);
  scene.add(ambientLight);
  
  // Main directional light with blue tint
  const mainLight = new THREE.DirectionalLight(0x6080ff, 0.7);
  mainLight.position.set(5, 10, 7);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.width = 512; // Lower resolution for performance
  mainLight.shadow.mapSize.height = 512;
  scene.add(mainLight);
  
  // Accent light with contrasting color
  const accentLight = new THREE.DirectionalLight(0xff8030, 0.5);
  accentLight.position.set(-7, 3, -5);
  scene.add(accentLight);
  
  // Add hemisphere light for better overall illumination
  const hemiLight = new THREE.HemisphereLight(0x8080ff, 0x404040, 0.6);
  scene.add(hemiLight);
};

// Add alias for compatibility with existing code
export const createLighting = createBasicStudioLighting;

// Helper function to remove existing lights
const removeExistingLights = (scene: THREE.Scene) => {
  scene.children.forEach((child) => {
    if (
      child instanceof THREE.DirectionalLight ||
      child instanceof THREE.SpotLight ||
      child instanceof THREE.PointLight ||
      child instanceof THREE.AmbientLight ||
      child instanceof THREE.HemisphereLight
    ) {
      scene.remove(child);
    }
  });
};
