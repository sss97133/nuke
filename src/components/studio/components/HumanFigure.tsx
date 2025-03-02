
import * as THREE from 'three';

export const createHumanFigure = (): THREE.Group => {
  const humanGroup = new THREE.Group();
  
  // Constants
  const headRadius = 0.4;
  const neckHeight = 0.1;
  const torsoHeight = 1.5;
  const torsoWidth = 0.8;
  const torsoDepth = 0.4;
  const armLength = 1.2;
  const armWidth = 0.25;
  const legLength = 1.8;
  const legWidth = 0.3;
  
  // Materials
  const skinMaterial = new THREE.MeshPhongMaterial({ 
    color: 0xE0AC69, 
    specular: 0x111111,
    shininess: 30
  });
  
  const clothesMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x3366CC, 
    specular: 0x333333,
    shininess: 30
  });
  
  const pantsMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x333333, 
    specular: 0x222222,
    shininess: 30
  });
  
  // Head
  const headGeometry = new THREE.SphereGeometry(headRadius, 16, 16);
  const head = new THREE.Mesh(headGeometry, skinMaterial);
  head.position.y = torsoHeight + neckHeight + headRadius;
  head.castShadow = true;
  humanGroup.add(head);
  
  // Neck
  const neckGeometry = new THREE.CylinderGeometry(0.15, 0.15, neckHeight, 16);
  const neck = new THREE.Mesh(neckGeometry, skinMaterial);
  neck.position.y = torsoHeight + neckHeight/2;
  neck.castShadow = true;
  humanGroup.add(neck);
  
  // Torso
  const torsoGeometry = new THREE.BoxGeometry(torsoWidth, torsoHeight, torsoDepth);
  const torso = new THREE.Mesh(torsoGeometry, clothesMaterial);
  torso.position.y = torsoHeight/2;
  torso.castShadow = true;
  humanGroup.add(torso);
  
  // Left Arm
  const leftArm = new THREE.Group();
  
  const leftShoulderGeometry = new THREE.SphereGeometry(0.2, 16, 16);
  const leftShoulder = new THREE.Mesh(leftShoulderGeometry, clothesMaterial);
  leftShoulder.position.x = -torsoWidth/2;
  leftShoulder.position.y = torsoHeight - 0.2;
  leftArm.add(leftShoulder);
  
  const leftArmGeometry = new THREE.CylinderGeometry(armWidth/2, armWidth/2, armLength, 16);
  const leftArmMesh = new THREE.Mesh(leftArmGeometry, skinMaterial);
  leftArmMesh.rotation.z = -Math.PI/16;
  leftArmMesh.position.x = -torsoWidth/2 - armLength/2 * Math.sin(Math.PI/16);
  leftArmMesh.position.y = torsoHeight - 0.2 - armLength/2 * Math.cos(Math.PI/16);
  leftArmMesh.castShadow = true;
  leftArm.add(leftArmMesh);
  
  humanGroup.add(leftArm);
  
  // Right Arm
  const rightArm = new THREE.Group();
  
  const rightShoulderGeometry = new THREE.SphereGeometry(0.2, 16, 16);
  const rightShoulder = new THREE.Mesh(rightShoulderGeometry, clothesMaterial);
  rightShoulder.position.x = torsoWidth/2;
  rightShoulder.position.y = torsoHeight - 0.2;
  rightArm.add(rightShoulder);
  
  const rightArmGeometry = new THREE.CylinderGeometry(armWidth/2, armWidth/2, armLength, 16);
  const rightArmMesh = new THREE.Mesh(rightArmGeometry, skinMaterial);
  rightArmMesh.rotation.z = Math.PI/16;
  rightArmMesh.position.x = torsoWidth/2 + armLength/2 * Math.sin(Math.PI/16);
  rightArmMesh.position.y = torsoHeight - 0.2 - armLength/2 * Math.cos(Math.PI/16);
  rightArmMesh.castShadow = true;
  rightArm.add(rightArmMesh);
  
  humanGroup.add(rightArm);
  
  // Legs
  const leftLegGeometry = new THREE.CylinderGeometry(legWidth/2, legWidth/2, legLength, 16);
  const leftLeg = new THREE.Mesh(leftLegGeometry, pantsMaterial);
  leftLeg.position.set(-torsoWidth/4, -legLength/2, 0);
  leftLeg.castShadow = true;
  humanGroup.add(leftLeg);
  
  const rightLegGeometry = new THREE.CylinderGeometry(legWidth/2, legWidth/2, legLength, 16);
  const rightLeg = new THREE.Mesh(rightLegGeometry, pantsMaterial);
  rightLeg.position.set(torsoWidth/4, -legLength/2, 0);
  rightLeg.castShadow = true;
  humanGroup.add(rightLeg);
  
  // Adjust scale to human height (around 5.5-6 feet)
  humanGroup.scale.set(0.5, 0.5, 0.5);
  
  // Set position so the feet are on the ground
  humanGroup.position.y = legLength * 0.5 / 2;
  
  return humanGroup;
};
