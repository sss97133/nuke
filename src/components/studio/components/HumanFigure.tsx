
import * as THREE from 'three';

export const HumanFigure = (): THREE.Group => {
  const humanGroup = new THREE.Group();
  
  // Create a simple human figure
  const bodyColor = new THREE.Color(0x3366bb);
  
  // Head
  const headGeometry = new THREE.SphereGeometry(0.4, 16, 16);
  const headMaterial = new THREE.MeshStandardMaterial({ 
    color: 0xffdbac,
    roughness: 0.7,
  });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = 3;
  head.castShadow = true;
  humanGroup.add(head);
  
  // Body
  const bodyGeometry = new THREE.CylinderGeometry(0.4, 0.5, 1.5, 8);
  const bodyMaterial = new THREE.MeshStandardMaterial({ 
    color: bodyColor,
    roughness: 0.9,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 2;
  body.castShadow = true;
  humanGroup.add(body);
  
  // Lower body
  const lowerBodyGeometry = new THREE.CylinderGeometry(0.5, 0.4, 0.8, 8);
  const lowerBodyMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x333333,
    roughness: 0.9,
  });
  const lowerBody = new THREE.Mesh(lowerBodyGeometry, lowerBodyMaterial);
  lowerBody.position.y = 1.1;
  lowerBody.castShadow = true;
  humanGroup.add(lowerBody);
  
  // Arms
  const armGeometry = new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8);
  
  // Left arm
  const leftArm = new THREE.Mesh(armGeometry, bodyMaterial);
  leftArm.position.set(0.65, 2.3, 0);
  leftArm.rotation.z = -0.3;
  leftArm.castShadow = true;
  humanGroup.add(leftArm);
  
  // Right arm
  const rightArm = new THREE.Mesh(armGeometry, bodyMaterial);
  rightArm.position.set(-0.65, 2.3, 0);
  rightArm.rotation.z = 0.3;
  rightArm.castShadow = true;
  humanGroup.add(rightArm);
  
  // Legs
  const legGeometry = new THREE.CylinderGeometry(0.2, 0.15, 1.2, 8);
  const legMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x333333,
    roughness: 0.9,
  });
  
  // Left leg
  const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
  leftLeg.position.set(0.3, 0.2, 0);
  leftLeg.castShadow = true;
  humanGroup.add(leftLeg);
  
  // Right leg
  const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
  rightLeg.position.set(-0.3, 0.2, 0);
  rightLeg.castShadow = true;
  humanGroup.add(rightLeg);
  
  // Set the pivot point at the bottom of the model
  humanGroup.position.y = 0.6;
  
  return humanGroup;
};
