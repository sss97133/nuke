
import * as THREE from 'three';

export const createHuman = (scene: THREE.Scene) => {
  const human = new THREE.Group();
  const humanHeight = 6;
  
  // Create a more detailed human figure
  // Body
  const bodyGeometry = new THREE.CapsuleGeometry(0.8, humanHeight/2, 8, 8);
  const bodyMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x2c3e50,  // Dark blue suit color
    specular: 0x222222,
    shininess: 30
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = humanHeight/4;
  human.add(body);

  // Head
  const headGeometry = new THREE.SphereGeometry(0.8, 16, 16);
  const headMaterial = new THREE.MeshPhongMaterial({ 
    color: 0xe0ac69,  // Skin tone
    specular: 0x222222,
    shininess: 30
  });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = humanHeight/2 + 0.8;
  human.add(head);
  
  // Hair
  const hairGeometry = new THREE.SphereGeometry(0.85, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const hairMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x3d2314,  // Dark brown hair
    specular: 0x222222,
    shininess: 10
  });
  const hair = new THREE.Mesh(hairGeometry, hairMaterial);
  hair.position.y = humanHeight/2 + 0.8 + 0.05;
  hair.rotation.x = -0.2;
  human.add(hair);

  // Eyes
  const eyeGeometry = new THREE.SphereGeometry(0.15, 8, 8);
  const eyeMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff });
  const pupilGeometry = new THREE.SphereGeometry(0.07, 8, 8);
  const pupilMaterial = new THREE.MeshPhongMaterial({ color: 0x222222 });
  
  // Left eye
  const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  leftEye.position.set(0.25, humanHeight/2 + 0.9, 0.6);
  human.add(leftEye);
  
  const leftPupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
  leftPupil.position.z = 0.08;
  leftEye.add(leftPupil);
  
  // Right eye
  const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  rightEye.position.set(-0.25, humanHeight/2 + 0.9, 0.6);
  human.add(rightEye);
  
  const rightPupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
  rightPupil.position.z = 0.08;
  rightEye.add(rightPupil);
  
  // Mouth
  const mouthGeometry = new THREE.BoxGeometry(0.3, 0.05, 0.05);
  const mouthMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
  const mouth = new THREE.Mesh(mouthGeometry, mouthMaterial);
  mouth.position.set(0, humanHeight/2 + 0.6, 0.7);
  human.add(mouth);

  // Arms
  const armGeometry = new THREE.CapsuleGeometry(0.3, humanHeight/3, 8, 8);
  const armMaterial = bodyMaterial;
  
  // Left arm
  const leftArm = new THREE.Mesh(armGeometry, armMaterial);
  leftArm.position.set(1.1, humanHeight/4, 0);
  leftArm.rotation.z = -0.2;
  human.add(leftArm);
  
  // Right arm
  const rightArm = new THREE.Mesh(armGeometry, armMaterial);
  rightArm.position.set(-1.1, humanHeight/4, 0);
  rightArm.rotation.z = 0.2;
  human.add(rightArm);

  // Legs
  const legGeometry = new THREE.CapsuleGeometry(0.4, humanHeight/2.5, 8, 8);
  const legMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x34495e,  // Slightly different shade for pants
    specular: 0x222222,
    shininess: 30
  });
  
  // Left leg
  const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
  leftLeg.position.set(0.5, -humanHeight/5, 0);
  human.add(leftLeg);
  
  // Right leg
  const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
  rightLeg.position.set(-0.5, -humanHeight/5, 0);
  human.add(rightLeg);

  // Hands
  const handGeometry = new THREE.SphereGeometry(0.35, 8, 8);
  const handMaterial = new THREE.MeshPhongMaterial({ color: 0xe0ac69 });
  
  // Left hand
  const leftHand = new THREE.Mesh(handGeometry, handMaterial);
  leftHand.position.set(0, -humanHeight/6, 0);
  leftArm.add(leftHand);
  
  // Right hand
  const rightHand = new THREE.Mesh(handGeometry, handMaterial);
  rightHand.position.set(0, -humanHeight/6, 0);
  rightArm.add(rightHand);

  // Feet
  const footGeometry = new THREE.BoxGeometry(0.5, 0.3, 1);
  const footMaterial = new THREE.MeshPhongMaterial({ color: 0x222222 }); // Black shoes
  
  // Left foot
  const leftFoot = new THREE.Mesh(footGeometry, footMaterial);
  leftFoot.position.set(0, -humanHeight/5, 0.2);
  leftLeg.add(leftFoot);
  
  // Right foot
  const rightFoot = new THREE.Mesh(footGeometry, footMaterial);
  rightFoot.position.set(0, -humanHeight/5, 0.2);
  rightLeg.add(rightFoot);

  // Position the human on the ground
  human.position.y = humanHeight/2;
  scene.add(human);
  
  return human;
};
