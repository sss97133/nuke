
import * as THREE from 'three';

/**
 * Creates basic studio lighting setup with ambient and directional lights
 */
export const createBasicStudioLighting = (scene: THREE.Scene) => {
  // First, remove any existing lights
  removeExistingLights(scene);
  
  // Ambient light for base illumination
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  
  // Main key light (from front-top)
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
  keyLight.position.set(0, 10, 10);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  scene.add(keyLight);
  
  // Fill light (from left)
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
  fillLight.position.set(-10, 5, 2);
  scene.add(fillLight);
  
  // Back light (rim light)
  const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
  backLight.position.set(5, 5, -8);
  scene.add(backLight);
  
  return { ambientLight, keyLight, fillLight, backLight };
};

/**
 * Creates enhanced product lighting for showcasing vehicles and products
 */
export const createProductLighting = (scene: THREE.Scene) => {
  // First, remove any existing lights
  removeExistingLights(scene);
  
  // Ambient light (stronger for product view)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);
  
  // Main product light (front top)
  const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
  mainLight.position.set(0, 15, 15);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.width = 2048;
  mainLight.shadow.mapSize.height = 2048;
  scene.add(mainLight);
  
  // Left product light
  const leftLight = new THREE.SpotLight(0xffffea, 0.6);
  leftLight.position.set(-15, 8, 0);
  leftLight.angle = Math.PI / 6;
  leftLight.penumbra = 0.2;
  scene.add(leftLight);
  
  // Right product light
  const rightLight = new THREE.SpotLight(0xeaffff, 0.6);
  rightLight.position.set(15, 8, 0);
  rightLight.angle = Math.PI / 6;
  rightLight.penumbra = 0.2;
  scene.add(rightLight);
  
  // Bottom fill light
  const bottomLight = new THREE.DirectionalLight(0xffffff, 0.4);
  bottomLight.position.set(0, -5, 5);
  scene.add(bottomLight);
  
  return { ambientLight, mainLight, leftLight, rightLight, bottomLight };
};

/**
 * Creates visualization lighting optimized for data and technical visualization
 */
export const createVisualizationLighting = (scene: THREE.Scene) => {
  // First, remove any existing lights
  removeExistingLights(scene);
  
  // Strong ambient light for clear visibility
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);
  
  // Top light
  const topLight = new THREE.DirectionalLight(0xffffff, 0.7);
  topLight.position.set(0, 20, 0);
  scene.add(topLight);
  
  // Front light
  const frontLight = new THREE.DirectionalLight(0xffffff, 0.5);
  frontLight.position.set(0, 0, 20);
  scene.add(frontLight);
  
  // Create an array of colored point lights around the scene
  const colors = [0x4285F4, 0x34A853, 0xFBBC05, 0xEA4335]; // Google-inspired colors
  const pointLights = [];
  
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const light = new THREE.PointLight(colors[i], 0.3);
    const radius = 15;
    light.position.set(
      Math.cos(angle) * radius,
      3 + (i % 2) * 5, // Alternate heights
      Math.sin(angle) * radius
    );
    scene.add(light);
    pointLights.push(light);
  }
  
  return { ambientLight, topLight, frontLight, pointLights };
};

/**
 * Helper function to remove existing lights from a scene
 */
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
