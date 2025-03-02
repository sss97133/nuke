
import * as THREE from 'three';
import type { WorkspaceDimensions } from '../types/workspace';

export const createLighting = (scene: THREE.Scene, dimensions: WorkspaceDimensions) => {
  const lightingGroup = new THREE.Group();
  
  // Remove existing lights if any
  scene.children.forEach(child => {
    if (child.type === 'DirectionalLight' || child.type === 'AmbientLight' || child.type === 'SpotLight') {
      scene.remove(child);
    }
  });

  // Add ambient light for base illumination
  const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
  scene.add(ambientLight);
  lightingGroup.add(ambientLight);
  
  // Add main key light
  const keyLight = new THREE.DirectionalLight(0xffffff, 1);
  keyLight.position.set(dimensions.width/2, dimensions.height/2, dimensions.length/2);
  keyLight.castShadow = true;
  
  // Configure shadow properties
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  // Fix: Remove the incorrect property assignment
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = dimensions.length * 3;
  
  // Set up shadow camera bounds
  const d = Math.max(dimensions.width, dimensions.length) / 2;
  keyLight.shadow.camera.left = -d;
  keyLight.shadow.camera.right = d;
  keyLight.shadow.camera.top = d;
  keyLight.shadow.camera.bottom = -d;
  
  scene.add(keyLight);
  lightingGroup.add(keyLight);

  // Add fill light (opposite of key light but softer)
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
  fillLight.position.set(-dimensions.width/2, dimensions.height/3, -dimensions.length/2);
  scene.add(fillLight);
  lightingGroup.add(fillLight);

  // Create studio light fixtures
  const spotLightCount = 6;
  const spotLightPositions = [
    // Front row
    { x: -dimensions.width/4, y: dimensions.height/2 - 0.5, z: -dimensions.length/3 },
    { x: 0, y: dimensions.height/2 - 0.5, z: -dimensions.length/3 },
    { x: dimensions.width/4, y: dimensions.height/2 - 0.5, z: -dimensions.length/3 },
    
    // Back row
    { x: -dimensions.width/4, y: dimensions.height/2 - 0.5, z: dimensions.length/3 },
    { x: 0, y: dimensions.height/2 - 0.5, z: dimensions.length/3 },
    { x: dimensions.width/4, y: dimensions.height/2 - 0.5, z: dimensions.length/3 },
  ];
  
  for (let i = 0; i < spotLightCount; i++) {
    // Create physical light fixture
    const fixtureGroup = new THREE.Group();
    
    // Light housing
    const housingGeometry = new THREE.CylinderGeometry(0.8, 1.2, 1.5, 12);
    const housingMaterial = new THREE.MeshPhongMaterial({ 
      color: 0x333333,
      specular: 0x111111,
      shininess: 50
    });
    const housing = new THREE.Mesh(housingGeometry, housingMaterial);
    
    // Rotate to point downward
    housing.rotation.x = Math.PI / 2;
    fixtureGroup.add(housing);
    
    // Light lens
    const lensGeometry = new THREE.CircleGeometry(0.7, 16);
    const lensMaterial = new THREE.MeshPhongMaterial({ 
      color: 0xffcc77, 
      emissive: 0xffcc77,
      emissiveIntensity: 0.5
    });
    const lens = new THREE.Mesh(lensGeometry, lensMaterial);
    lens.position.set(0, 0, -0.76);  // Position at front of housing
    lens.rotation.x = Math.PI / 2;
    housing.add(lens);
    
    // Light mount (connects to ceiling)
    const mountGeometry = new THREE.CylinderGeometry(0.2, 0.2, dimensions.height/10, 8);
    const mountMaterial = new THREE.MeshPhongMaterial({ color: 0x666666 });
    const mount = new THREE.Mesh(mountGeometry, mountMaterial);
    mount.position.y = dimensions.height/20;
    fixtureGroup.add(mount);
    
    // Position the fixture
    const pos = spotLightPositions[i];
    fixtureGroup.position.set(pos.x, pos.y, pos.z);
    
    // Create target for spotlight to look at
    const targetObject = new THREE.Object3D();
    targetObject.position.set(pos.x, -dimensions.height/2, pos.z);
    scene.add(targetObject);
    
    // Create actual light
    const spotLight = new THREE.SpotLight(0xffcc77, 10, dimensions.height * 2, Math.PI/6, 0.5, 1);
    spotLight.position.copy(fixtureGroup.position);
    spotLight.target = targetObject;
    
    // Enable shadows for some lights (not all, for performance)
    if (i % 2 === 0) {
      spotLight.castShadow = true;
      spotLight.shadow.mapSize.width = 1024;
      spotLight.shadow.mapSize.height = 1024;
    }
    
    // Add a slight random hue variation to each light
    const hueShift = (Math.random() * 0.1) - 0.05;
    const color = new THREE.Color(0xffcc77);
    color.offsetHSL(hueShift, 0, 0);
    spotLight.color = color;
    lens.material.color = color;
    lens.material.emissive = color;
    
    // Add to scene
    scene.add(spotLight);
    scene.add(fixtureGroup);
    lightingGroup.add(fixtureGroup);
    lightingGroup.add(spotLight);
    
    // Create visible light beam using volumetric-like effect
    const coneHeight = dimensions.height;
    const coneRadius = Math.tan(Math.PI/6) * coneHeight;
    
    const coneGeometry = new THREE.ConeGeometry(coneRadius, coneHeight, 16, 4);
    const coneMaterial = new THREE.MeshBasicMaterial({ 
      color: color,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide
    });
    
    const cone = new THREE.Mesh(coneGeometry, coneMaterial);
    cone.position.y = -coneHeight/2;
    cone.rotation.x = Math.PI;
    
    fixtureGroup.add(cone);
  }
  
  // Enable shadow rendering
  if (scene.userData.renderer) {
    scene.userData.renderer.shadowMap.enabled = true;
    scene.userData.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  
  return lightingGroup;
};

// Helper function to create a specific lighting preset
export const createBasicStudioLighting = (scene: THREE.Scene) => {
  const dimensions: WorkspaceDimensions = {
    width: 20,
    height: 10,
    length: 20
  };
  
  return createLighting(scene, dimensions);
};

// Helper function to create a product photography lighting setup
export const createProductLighting = (scene: THREE.Scene) => {
  const dimensions: WorkspaceDimensions = {
    width: 10,
    height: 8,
    length: 10
  };
  
  const lightingGroup = createLighting(scene, dimensions);
  
  // Add additional product-specific lighting (e.g., a soft box light)
  const softBoxLight = new THREE.RectAreaLight(0xffffff, 5, 4, 4);
  softBoxLight.position.set(0, 3, 5);
  softBoxLight.lookAt(0, 0, 0);
  scene.add(softBoxLight);
  lightingGroup.add(softBoxLight);
  
  return lightingGroup;
};
