
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Skill, UserSkill } from '@/types/skills';

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

  const calculateCareerMomentum = () => {
    if (!userSkills || userSkills.length === 0) return 0.001;
    
    const totalXP = userSkills.reduce((sum, skill) => sum + skill.experience_points, 0);
    const avgXP = totalXP / userSkills.length;
    return Math.min(0.003, Math.max(0.0005, (avgXP / 5000) * 0.002));
  };

  const calculateSkillInteraction = (skill1: UserSkill, skill2: UserSkill) => {
    const levelDiff = Math.abs(skill1.level - skill2.level);
    return Math.exp(-levelDiff) * 0.01;
  };

  useEffect(() => {
    if (!containerRef.current) return;

    sceneRef.current = new THREE.Scene();
    sceneRef.current.background = new THREE.Color(0x000000);
    
    cameraRef.current = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    
    rendererRef.current = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true 
    });
    rendererRef.current.setSize(
      containerRef.current.clientWidth,
      containerRef.current.clientHeight
    );
    
    // Fix: Append the renderer's domElement instead of the renderer itself
    containerRef.current.appendChild(rendererRef.current.domElement);

    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    sceneRef.current.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(10, 10, 10);
    sceneRef.current.add(pointLight);

    cameraRef.current.position.z = 15;
    cameraRef.current.position.y = 5;
    cameraRef.current.lookAt(0, 0, 0);

    const categoryColors: { [key: string]: THREE.Color } = {
      mechanical: new THREE.Color(0xff3366),
      electrical: new THREE.Color(0x33ff66),
      bodywork: new THREE.Color(0x3366ff),
      diagnostics: new THREE.Color(0xff66ff),
      restoration: new THREE.Color(0xffff33),
      customization: new THREE.Color(0x33ffff),
    };

    const skillsByCategory = skills.reduce((acc: { [key: string]: Skill[] }, skill) => {
      if (!acc[skill.category]) {
        acc[skill.category] = [];
      }
      acc[skill.category].push(skill);
      return acc;
    }, {});

    Object.entries(skillsByCategory).forEach(([category, categorySkills], categoryIndex) => {
      const baseRadius = (categoryIndex + 2) * 2;
      const color = categoryColors[category] || new THREE.Color(0xffffff);
      
      const orbitalGeometry = new THREE.TorusGeometry(
        baseRadius,
        0.02 * (1 + categorySkills.length * 0.1),
        16,
        100
      );
      const orbitalMaterial = new THREE.MeshPhongMaterial({ 
        color: color,
        transparent: true,
        opacity: 0.3,
        emissive: color,
        emissiveIntensity: 0.2
      });
      const orbital = new THREE.Mesh(orbitalGeometry, orbitalMaterial);
      orbital.rotation.x = Math.PI / 2;
      sceneRef.current.add(orbital);

      categorySkills.forEach((skill, skillIndex) => {
        const userSkill = userSkills.find(us => us.skill_id === skill.id);
        const level = userSkill?.level || 0;
        const particleCount = 50 + level * 20;

        const particles = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);
        
        for (let i = 0; i < particleCount; i++) {
          const angle = (i / particleCount) * Math.PI * 2;
          const radiusVariation = (Math.random() - 0.5) * (0.5 / (level + 1));
          const heightVariation = (Math.random() - 0.5) * (0.5 / (level + 1));
          
          particles[i * 3] = (baseRadius + radiusVariation) * Math.cos(angle);
          particles[i * 3 + 1] = heightVariation;
          particles[i * 3 + 2] = (baseRadius + radiusVariation) * Math.sin(angle);
          
          velocities[i * 3] = (Math.random() - 0.5) * 0.02 * (level + 1);
          velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.02 * (level + 1);
          velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02 * (level + 1);
        }

        const particleGeometry = new THREE.BufferGeometry();
        particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(particles, 3));
        
        const particleMaterial = new THREE.PointsMaterial({
          color: color,
          size: 0.05 + level * 0.02,
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
        });

        const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
        sceneRef.current?.add(particleSystem);
        particlesRef.current.push(particleSystem);
      });
    });

    const animate = () => {
      requestAnimationFrame(animate);
      
      if (sceneRef.current && cameraRef.current && rendererRef.current) {
        const spinRate = calculateCareerMomentum();
        sceneRef.current.rotation.y += spinRate;
        
        particlesRef.current.forEach((particles, idx) => {
          const positions = particles.geometry.attributes.position.array as Float32Array;
          
          for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const y = positions[i + 1];
            const z = positions[i + 2];
            
            const radius = Math.sqrt(x * x + z * z);
            const angle = Math.atan2(z, x);
            
            const waveFunction = Math.sin(angle * 2 + Date.now() * 0.001) * 0.02;
            const newAngle = angle + spinRate * (1 + waveFunction);
            
            positions[i] = radius * Math.cos(newAngle);
            positions[i + 1] = y + Math.sin(newAngle * 2) * 0.02;
            positions[i + 2] = radius * Math.sin(newAngle);
          }
          
          particles.geometry.attributes.position.needsUpdate = true;
        });
        
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

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

