
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Skill, UserSkill } from '@/types/skills';
import { categoryColors } from '../QuantumColors';
import { 
  calculateCareerMomentum,
  calculateQuantumState,
  calculateSuperpositionState,
  calculateProbabilityDensity
} from '../calculations';

interface SkillOrbitalsProps {
  scene: THREE.Scene;
  skills: Skill[];
  userSkills: UserSkill[];
}

const SkillOrbitals: React.FC<SkillOrbitalsProps> = ({ 
  scene, 
  skills, 
  userSkills 
}) => {
  const skillObjectsRef = useRef<THREE.Group>(new THREE.Group());
  const orbitLinesRef = useRef<THREE.Line[]>([]);
  
  // Ref to hold the animation functions
  const animationRef = useRef({
    animateSkills: (time: number) => {
      if (!skillObjectsRef.current) return;
      
      const momentum = calculateCareerMomentum(userSkills);
      
      // Move skill particles along orbits
      skillObjectsRef.current.children.forEach((skillGroup) => {
        if (skillGroup instanceof THREE.Group) {
          const userData = skillGroup.userData;
          const skillLevel = userData.skillLevel || 0;
          
          // Get current position (relative to center)
          const currentPos = skillGroup.position.clone();
          const orbitRadius = currentPos.length();
          
          // Calculate current angle
          let angle = Math.atan2(currentPos.z, currentPos.x);
          
          // Apply momentum and quantum state
          const quantumState = calculateQuantumState(skillLevel, time);
          const waveFactor = Math.sin(angle * 3 + time) * 0.05 * quantumState;
          
          // Update angle based on momentum and quantum effects
          angle += momentum * (1 + waveFactor) * (skillLevel > 0 ? 1 : 0.7);
          
          // Superposition effects for higher level skills
          if (skillLevel >= 3) {
            const superposition = calculateSuperpositionState(skillLevel, 5, time);
            
            // Update position with superposition effects
            skillGroup.position.x = orbitRadius * Math.cos(angle) + superposition.x * 0.2;
            skillGroup.position.z = orbitRadius * Math.sin(angle) + superposition.y * 0.2;
            
            // Add vertical oscillation based on superposition strength
            skillGroup.position.y = Math.sin(time * (1 + skillLevel * 0.1)) * superposition.strength * 0.5;
          } else {
            // Simple circular motion for lower level skills
            skillGroup.position.x = orbitRadius * Math.cos(angle);
            skillGroup.position.z = orbitRadius * Math.sin(angle);
            
            // Small vertical oscillation
            skillGroup.position.y = Math.sin(angle * 2 + time) * 0.05 * skillLevel;
          }
          
          // Skill particle rotation
          if (skillGroup.children.length > 0) {
            const particle = skillGroup.children[0];
            if (particle instanceof THREE.Mesh) {
              particle.rotation.y += 0.01 + (skillLevel * 0.005);
              particle.rotation.z += 0.005 + (skillLevel * 0.002);
            }
            
            // Quantum cloud animation
            if (skillGroup.children.length > 1) {
              const cloud = skillGroup.children[1];
              if (cloud instanceof THREE.Points) {
                cloud.rotation.x += 0.003;
                cloud.rotation.y += 0.005;
                cloud.rotation.z += 0.002;
                
                // Pulse effect based on quantum state
                const pulse = 1 + 0.1 * Math.sin(time * (1 + skillLevel * 0.2));
                cloud.scale.set(pulse, pulse, pulse);
              }
            }
          }
        }
      });
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
      const color = categoryColors[category as keyof typeof categoryColors] || new THREE.Color(0xffffff);
      
      // Create orbital path
      const orbitGeometry = new THREE.BufferGeometry();
      const orbitSegments = 128;
      const orbitVertices = [];
      
      for (let i = 0; i <= orbitSegments; i++) {
        const theta = (i / orbitSegments) * Math.PI * 2;
        const x = orbitRadius * Math.cos(theta);
        const z = orbitRadius * Math.sin(theta);
        orbitVertices.push(x, 0, z);
      }
      
      orbitGeometry.setAttribute('position', new THREE.Float32BufferAttribute(orbitVertices, 3));
      
      const orbitMaterial = new THREE.LineBasicMaterial({ 
        color: color,
        transparent: true,
        opacity: 0.3
      });
      
      const orbit = new THREE.Line(orbitGeometry, orbitMaterial);
      scene.add(orbit);
      orbitLinesRef.current.push(orbit);
      
      // Add skill particles along the orbit
      categorySkills.forEach((skill, skillIndex) => {
        const userSkill = userSkills.find(us => us.skill_id === skill.id);
        const skillLevel = userSkill?.level || 0;
        
        // Position around orbit
        const angle = (skillIndex / categorySkills.length) * Math.PI * 2;
        const x = orbitRadius * Math.cos(angle);
        const z = orbitRadius * Math.sin(angle);
        
        // Create particle size based on skill level
        const particleSize = 0.3 + (skillLevel * 0.15);
        const particleGeometry = new THREE.SphereGeometry(particleSize, 16, 16);
        
        // Color based on level
        const particleColor = new THREE.Color(color);
        if (skillLevel > 0) {
          // Brighten based on level
          particleColor.r = Math.min(1, particleColor.r + skillLevel * 0.06);
          particleColor.g = Math.min(1, particleColor.g + skillLevel * 0.06);
          particleColor.b = Math.min(1, particleColor.b + skillLevel * 0.06);
        }
        
        const particleMaterial = new THREE.MeshPhongMaterial({
          color: particleColor,
          emissive: skillLevel > 0 ? particleColor.clone().multiplyScalar(0.3) : 0x000000,
          transparent: true,
          opacity: 0.8
        });
        
        const particle = new THREE.Mesh(particleGeometry, particleMaterial);
        
        // Create a group for the particle
        const skillGroup = new THREE.Group();
        skillGroup.add(particle);
        skillGroup.position.set(x, 0, z);
        skillGroup.userData = { 
          skillId: skill.id,
          skillName: skill.name,
          skillLevel: skillLevel,
          category: skill.category
        };
        
        // Add quantum cloud if skill level > 0
        if (skillLevel > 0) {
          createQuantumCloud(skillLevel, particleSize, particleColor, skillGroup);
        }
        
        skillObjectsRef.current.add(skillGroup);
      });
    });
  }, [scene, skills, userSkills]);

  const createQuantumCloud = (
    skillLevel: number, 
    particleSize: number, 
    particleColor: THREE.Color, 
    skillGroup: THREE.Group
  ) => {
    const cloudCount = Math.max(5, skillLevel * 10);
    const cloudGeometry = new THREE.BufferGeometry();
    const cloudVertices = [];
    const cloudColors = [];
    
    for (let i = 0; i < cloudCount; i++) {
      // Use probability density function to distribute particles
      const distance = (Math.random() - 0.5) * 2;
      const density = calculateProbabilityDensity(distance, skillLevel);
      const radius = particleSize * (1 + density * 2);
      
      const cloudTheta = Math.random() * Math.PI * 2;
      const cloudPhi = Math.random() * Math.PI;
      
      const cloudX = radius * Math.sin(cloudPhi) * Math.cos(cloudTheta);
      const cloudY = radius * Math.sin(cloudPhi) * Math.sin(cloudTheta);
      const cloudZ = radius * Math.cos(cloudPhi);
      
      cloudVertices.push(cloudX, cloudY, cloudZ);
      
      // Color with some variation
      const colorIntensity = 0.4 + (Math.random() * 0.6);
      cloudColors.push(
        particleColor.r * colorIntensity,
        particleColor.g * colorIntensity,
        particleColor.b * colorIntensity
      );
    }
    
    cloudGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cloudVertices, 3));
    cloudGeometry.setAttribute('color', new THREE.Float32BufferAttribute(cloudColors, 3));
    
    const cloudMaterial = new THREE.PointsMaterial({
      size: 0.1,
      vertexColors: true,
      transparent: true,
      opacity: 0.7
    });
    
    const cloud = new THREE.Points(cloudGeometry, cloudMaterial);
    skillGroup.add(cloud);
  };

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

// Static method to create a handler for external use
(SkillOrbitals as any).getAnimationHandler = (props: SkillOrbitalsProps) => {
  return {
    animateSkills: (time: number) => {
      // This would be called by parent components
    },
    skillObjectsRef: { current: new THREE.Group() }
  };
};

export default SkillOrbitals;
