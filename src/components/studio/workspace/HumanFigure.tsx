import * as THREE from 'three';

interface HumanFigureProps {
  position: { x: number; y: number; z: number };
  scene: THREE.Scene;
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
}

export const createHumanFigure = ({ position, scene, dimensions }: HumanFigureProps) => {
  const human = new THREE.Group();
  const humanHeight = 6;
  
  // Body
  const bodyGeometry = new THREE.CylinderGeometry(0.4, 0.4, humanHeight/3, 8);
  const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x0000ff });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = humanHeight/6;
  human.add(body);

  // Head
  const headGeometry = new THREE.SphereGeometry(0.4, 8, 8);
  const headMaterial = new THREE.MeshPhongMaterial({ color: 0xffcc99 });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = humanHeight/3 + 0.4;
  human.add(head);

  // Legs
  const legGeometry = new THREE.CylinderGeometry(0.2, 0.2, humanHeight/2, 8);
  const legMaterial = new THREE.MeshPhongMaterial({ color: 0x0000ff });
  
  const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
  leftLeg.position.set(0.3, humanHeight/4, 0);
  human.add(leftLeg);
  
  const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
  rightLeg.position.set(-0.3, humanHeight/4, 0);
  human.add(rightLeg);

  // Constrain position within room bounds
  const x = Math.max(-dimensions.width/2 + 1, Math.min(dimensions.width/2 - 1, position.x));
  const y = Math.max(0, Math.min(dimensions.height - humanHeight, position.y));
  const z = Math.max(-dimensions.length/2 + 1, Math.min(dimensions.length/2 - 1, position.z));
  
  human.position.set(x, y, z);
  scene.add(human);
  
  return human;
};