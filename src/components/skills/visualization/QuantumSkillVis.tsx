
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Skill, UserSkill } from '@/types/skills';
import { createQuantumOrbit } from './quantum/QuantumOrbit';
import { createQuantumParticles } from './quantum/QuantumParticles';
import { 
  calculateCareerMomentum, 
  calculateQuantumState 
} from './quantum/calculations';
import { categoryColors } from './quantum/QuantumColors';

interface QuantumSkillVisProps {
  skills: Skill[];
  userSkills: UserSkill[];
}

export const QuantumSkillVis = ({ skills, userSkills }: QuantumSkillVisProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const particlesRef = useRef<THREE.Points[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    sceneRef.current = new THREE.Scene();
    sceneRef.current.background = new THREE.Color(0x000000);
    
    // Camera setup
    cameraRef.current = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    
    // Renderer setup
    rendererRef.current = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true 
    });
    rendererRef.current.setSize(
      containerRef.current.clientWidth,
      containerRef.current.clientHeight
    );
    
    containerRef.current.appendChild(rendererRef.current.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    sceneRef.current.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(10, 10, 10);
    sceneRef.current.add(pointLight);

    // Camera positioning
    cameraRef.current.position.z = 15;
    cameraRef.current.position.y = 5;
    cameraRef.current.lookAt(0, 0, 0);

    // Group skills by category
    const skillsByCategory = skills.reduce((acc: { [key: string]: Skill[] }, skill) => {
      if (!acc[skill.category]) {
        acc[skill.category] = [];
      }
      acc[skill.category].push(skill);
      return acc;
    }, {});

    // Create quantum visualization
    Object.entries(skillsByCategory).forEach(([category, categorySkills], categoryIndex) => {
      const baseRadius = (categoryIndex + 2) * 2;
      const color = categoryColors[category as keyof typeof categoryColors] || new THREE.Color(0xffffff);
      
      // Create orbital
      createQuantumOrbit({ 
        category: category as any, 
        baseRadius, 
        color, 
        scene: sceneRef.current! 
      });

      // Create particles for each skill
      categorySkills.forEach(skill => {
        const userSkill = userSkills.find(us => us.skill_id === skill.id);
        const particles = createQuantumParticles({
          baseRadius,
          color,
          userSkill,
          scene: sceneRef.current!
        });
        particlesRef.current.push(particles);
      });
    });

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      
      if (sceneRef.current && cameraRef.current && rendererRef.current) {
        const spinRate = calculateCareerMomentum(userSkills);
        const time = Date.now() * 0.001;
        
        sceneRef.current.rotation.y += spinRate;
        
        particlesRef.current.forEach((particles, idx) => {
          const positions = particles.geometry.attributes.position.array as Float32Array;
          
          for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const y = positions[i + 1];
            const z = positions[i + 2];
            
            const radius = Math.sqrt(x * x + z * z);
            const angle = Math.atan2(z, x);
            
            const userSkill = userSkills[Math.floor(idx / 2)];
            const quantumState = calculateQuantumState(userSkill?.level || 0, time);
            const waveFunction = Math.sin(angle * 3 + time) * 0.03 * quantumState;
            
            const newAngle = angle + spinRate * (1 + waveFunction);
            
            positions[i] = radius * Math.cos(newAngle);
            positions[i + 1] = y + Math.sin(newAngle * 2) * 0.03 * quantumState;
            positions[i + 2] = radius * Math.sin(newAngle);
          }
          
          particles.geometry.attributes.position.needsUpdate = true;
        });
        
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      
      cameraRef.current.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(
        containerRef.current.clientWidth,
        containerRef.current.clientHeight
      );
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (containerRef.current && rendererRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      particlesRef.current = [];
    };
  }, [skills, userSkills]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-[600px] rounded-lg overflow-hidden bg-black"
      style={{ touchAction: 'none' }}
    />
  );
};
