
import * as THREE from 'three';
import { SkillCategory } from '@/types/skills';

export const categoryColors: Record<SkillCategory, THREE.Color> = {
  mechanical: new THREE.Color(0xff3366),
  electrical: new THREE.Color(0x33ff66),
  bodywork: new THREE.Color(0x3366ff),
  diagnostics: new THREE.Color(0xff66ff),
  restoration: new THREE.Color(0xffff33),
  customization: new THREE.Color(0x33ffff),
  technical: new THREE.Color(0x66ff33),
  maintenance: new THREE.Color(0xff6633),
  soft_skills: new THREE.Color(0x3366ff),
  safety: new THREE.Color(0xff3333)
};
