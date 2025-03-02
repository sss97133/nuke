
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Skill, UserSkill } from '@/types/skills';
import { categoryColors } from '../QuantumColors';

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

  const calculateProbabilityDensity = (distance: number, skillLevel: number) => {
    // Higher skill levels have more concentrated probability density
    const uncertainty = 1 - (skillLevel / 10);
    const sigma = 0.5 * uncertainty;
    
    // Gaussian distribution for probability
    return Math.exp(-(distance * distance) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
  };

  const animateSkills = (time: number) => {
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
  };

  const calculateCareerMomentum = (userSkills: UserSkill[]) => {
    if (!userSkills || userSkills.length === 0) return 0.001;
    
    // Calculate total XP and average level
    const totalXP = userSkills.reduce((sum, skill) => sum + skill.experience_points, 0);
    const totalSkills = userSkills.length;
    const avgLevel = userSkills.reduce((sum, skill) => sum + skill.level, 0) / totalSkills;
    
    // Base momentum increases with skill level and XP
    const baseMomentum = (totalXP / (10000 * totalSkills)) * 0.002;
    
    // Add wave fluctuation for more organic movement
    const waveFactor = Math.sin(Date.now() * 0.0005) * 0.0005;
    
    // Apply skill level factor - higher skills = smoother, more controlled rotation
    const levelFactor = Math.min(1, avgLevel / 5);
    const stabilityFactor = 0.5 + (levelFactor * 0.5);
    
    // Calculate final momentum with constraints
    return Math.min(0.006, Math.max(0.0005, baseMomentum * stabilityFactor + waveFactor));
  };

  const calculateQuantumState = (skillLevel: number, time: number) => {
    // Base amplitude increases with skill level
    const amplitude = 0.3 + (skillLevel / 10);
    
    // Frequency changes with skill level - higher skills have more coherent waves
    const baseFrequency = 1 + (skillLevel * 0.2);
    
    // Add quantum uncertainty that decreases with skill level
    const uncertainty = (5 - skillLevel) * 0.05;
    const noise = Math.random() * uncertainty;
    
    // Calculate quantum wavefunction with time evolution
    const frequency = baseFrequency + (noise * Math.sin(time * 0.1));
    const waveFunction = amplitude * Math.sin(frequency * time);
    
    // Add harmonic overtones for higher skill levels
    let harmonics = 0;
    if (skillLevel > 1) {
      // Add first harmonic
      harmonics += (amplitude * 0.3) * Math.sin(frequency * 2 * time);
    }
    if (skillLevel > 3) {
      // Add second harmonic
      harmonics += (amplitude * 0.15) * Math.sin(frequency * 3 * time);
    }
    
    return waveFunction + harmonics;
  };

  const calculateSuperpositionState = (
    skillLevel: number, 
    relatedSkillsCount: number, 
    time: number
  ) => {
    // Base factors
    const levelFactor = skillLevel / 5;
    const breadthFactor = Math.min(1, relatedSkillsCount / 10);
    
    // Calculate superposition strength
    const superpositionStrength = levelFactor * breadthFactor;
    
    // Time-dependent phase oscillation
    const phaseOscillation = Math.sin(time * (1 + levelFactor)) * Math.PI;
    
    // Return superposition vector components (can be used for visual effects)
    return {
      x: superpositionStrength * Math.cos(phaseOscillation),
      y: superpositionStrength * Math.sin(phaseOscillation),
      strength: superpositionStrength
    };
  };

  return { animateSkills, skillObjectsRef };
};

export default SkillOrbitals;
