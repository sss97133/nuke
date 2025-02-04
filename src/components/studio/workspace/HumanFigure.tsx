import React from 'react';
import * as THREE from 'three';

interface HumanFigureProps {
  position: { x: number; y: number; z: number };
  scene: THREE.Scene;
}

export const createHumanFigure = ({ position, scene }: HumanFigureProps) => {
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

  // Position at specified coordinates
  human.position.set(position.x, position.y, position.z);
  scene.add(human);
  
  return human;
};