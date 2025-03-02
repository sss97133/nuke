
import * as THREE from 'three';

// Create basic studio lighting setup
export const createBasicStudioLighting = (scene: THREE.Scene) => {
  // Ambient light
  const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
  scene.add(ambientLight);
  
  // Main directional light (key light)
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
  keyLight.position.set(5, 10, 5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  scene.add(keyLight);
  
  // Fill light
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
  fillLight.position.set(-5, 8, 5);
  scene.add(fillLight);
  
  // Back light
  const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
  backLight.position.set(0, 6, -8);
  scene.add(backLight);
  
  return { ambientLight, keyLight, fillLight, backLight };
};

// Create product-focused lighting setup
export const createProductLighting = (scene: THREE.Scene) => {
  // Ambient light (lower intensity for stronger shadows)
  const ambientLight = new THREE.AmbientLight(0x404040, 0.8);
  scene.add(ambientLight);
  
  // Key spotlight focused on product
  const keySpotLight = new THREE.SpotLight(0xffffff, 1.5);
  keySpotLight.position.set(0, 12, 5);
  keySpotLight.angle = Math.PI / 6;
  keySpotLight.penumbra = 0.3;
  keySpotLight.decay = 1.5;
  keySpotLight.castShadow = true;
  keySpotLight.shadow.mapSize.width = 2048;
  keySpotLight.shadow.mapSize.height = 2048;
  scene.add(keySpotLight);
  
  // Accent lights
  const accentLight1 = new THREE.SpotLight(0x0066ff, 0.8);
  accentLight1.position.set(-5, 7, 0);
  accentLight1.angle = Math.PI / 8;
  accentLight1.penumbra = 0.5;
  accentLight1.decay = 1;
  scene.add(accentLight1);
  
  const accentLight2 = new THREE.SpotLight(0xff6600, 0.8);
  accentLight2.position.set(5, 7, 0);
  accentLight2.angle = Math.PI / 8;
  accentLight2.penumbra = 0.5;
  accentLight2.decay = 1;
  scene.add(accentLight2);
  
  return { ambientLight, keySpotLight, accentLight1, accentLight2 };
};

// Export alias for backward compatibility
export const createLighting = createBasicStudioLighting;
