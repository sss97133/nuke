
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Skill, UserSkill } from '@/types/skills';
import { createOrbit } from './SkillOrbits';
import { createSkillParticle } from './SkillParticle';
import { animateSkills } from './SkillAnimation';

interface SkillOrbitalsProps {
  scene: THREE.Scene;
  skills: Skill[];
  userSkills: UserSkill[];
}

const SkillOrbitals = ({ 
  scene, 
  skills, 
  userSkills 
}: SkillOrbitalsProps) => {
  const skillObjectsRef = useRef<THREE.Group>(new THREE.Group());
  const orbitLinesRef = useRef<THREE.Line[]>([]);
  
  // Ref to hold the animation functions
  const animationRef = useRef({
    animateSkills: (time: number) => {
      animateSkills(time, skillObjectsRef, userSkills);
    }
  });

  useEffect(() => {
    if (!scene || !skills.length) return;
    
    // Add skill objects group
    scene.add(skillObjectsRef.current);
    
    return () => {
      // Cleanup on unmount
      scene.remove(skillObjectsRef.current);
      orbitLinesRef.current.forEach(line => {
        scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
    };
  }, [scene]);

  useEffect(() => {
    if (!scene || !skills.length) return;
    
    // Clear previous skill objects
    while (skillObjectsRef.current.children.length > 0) {
      skillObjectsRef.current.remove(skillObjectsRef.current.children[0]);
    }
    
    // Clear previous orbit lines
    orbitLinesRef.current.forEach(line => {
      if (scene) scene.remove(line);
    });
    orbitLinesRef.current = [];
    
    // Group skills by category
    const skillsByCategory = skills.reduce((acc: Record<string, Skill[]>, skill) => {
      if (!acc[skill.category]) {
        acc[skill.category] = [];
      }
      acc[skill.category].push(skill);
      return acc;
    }, {});
    
    // Create orbits and skill particles for each category
    Object.entries(skillsByCategory).forEach(([category, categorySkills], categoryIndex) => {
      const orbitRadius = (categoryIndex + 2) * 4;
      
      // Create orbital path
      const { color } = createOrbit({
        scene,
        category,
        categorySkills,
        orbitRadius,
        orbitLinesRef
      });
      
      // Add skill particles along the orbit
      categorySkills.forEach((skill, skillIndex) => {
        const userSkill = userSkills.find(us => us.skill_id === skill.id);
        const angle = (skillIndex / categorySkills.length) * Math.PI * 2;
        
        createSkillParticle({
          skill,
          userSkill,
          angle,
          orbitRadius,
          color,
          skillObjectsRef
        });
      });
    });
  }, [scene, skills, userSkills]);

  // We use a div with a ref to expose our animation functions
  return (
    <div ref={(el) => {
      // Expose our animation methods and refs to parent components
      if (el) {
        (el as any).animateSkills = animationRef.current.animateSkills;
        (el as any).skillObjectsRef = skillObjectsRef;
      }
    }} style={{ display: 'none' }} />
  );
};

export default SkillOrbitals;
