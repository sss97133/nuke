
import * as THREE from 'three';

export const categoryColors: Record<string, THREE.Color> = {
  mechanical: new THREE.Color(0x3498db),  // Blue
  electrical: new THREE.Color(0xe74c3c),  // Red
  bodywork: new THREE.Color(0x9b59b6),    // Purple
  diagnostics: new THREE.Color(0x2ecc71), // Green
  restoration: new THREE.Color(0xf39c12), // Orange
  customization: new THREE.Color(0x1abc9c), // Teal
  technical: new THREE.Color(0x2980b9),   // Dark Blue
  maintenance: new THREE.Color(0x27ae60), // Dark Green
  soft_skills: new THREE.Color(0x8e44ad), // Dark Purple
  safety: new THREE.Color(0xc0392b)       // Dark Red
};
