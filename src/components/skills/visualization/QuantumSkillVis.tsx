
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

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize Three.js scene
    sceneRef.current = new THREE.Scene();
    cameraRef.current = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    rendererRef.current = new THREE.WebGLRenderer({ antialias: true });
    rendererRef.current.setSize(
      containerRef.current.clientWidth,
      containerRef.current.clientHeight
    );
    containerRef.current.appendChild(rendererRef.current.domElement);

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0x404040);
    sceneRef.current.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1);
    sceneRef.current.add(directionalLight);

    // Position camera
    cameraRef.current.position.z = 5;

    // Create orbital geometries for each skill category
    const categoryColors: { [key: string]: number } = {
      mechanical: 0xff0000,
      electrical: 0x00ff00,
      bodywork: 0x0000ff,
      diagnostics: 0xff00ff,
      restoration: 0xffff00,
      customization: 0x00ffff,
    };

    // Group skills by category
    const skillsByCategory = skills.reduce((acc: { [key: string]: Skill[] }, skill) => {
      if (!acc[skill.category]) {
        acc[skill.category] = [];
      }
      acc[skill.category].push(skill);
      return acc;
    }, {});

    // Create orbital shells for each category
    Object.entries(skillsByCategory).forEach(([category, categorySkills], index) => {
      const radius = (index + 2) * 0.8;
      const orbital = createOrbitalShape(radius, categoryColors[category] || 0xffffff);
      sceneRef.current?.add(orbital);

      // Add skill points within the orbital
      categorySkills.forEach((skill, skillIndex) => {
        const angle = (skillIndex / categorySkills.length) * Math.PI * 2;
        const skillPoint = createSkillPoint(
          radius * Math.cos(angle),
          radius * Math.sin(angle),
          index * 0.5,
          userSkills.find(us => us.skill_id === skill.id)?.level || 0
        );
        sceneRef.current?.add(skillPoint);
      });
    });

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      
      if (sceneRef.current && cameraRef.current && rendererRef.current) {
        // Rotate the entire scene slowly
        sceneRef.current.rotation.y += 0.001;
        
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
      containerRef.current?.removeChild(rendererRef.current?.domElement!);
    };
  }, [skills, userSkills]);

  // Helper function to create orbital shape
  const createOrbitalShape = (radius: number, color: number) => {
    const points = [];
    for (let i = 0; i <= 100; i++) {
      const angle = (i / 50) * Math.PI;
      points.push(
        new THREE.Vector3(
          radius * Math.cos(angle),
          radius * Math.sin(angle),
          0
        )
      );
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 });
    return new THREE.Line(geometry, material);
  };

  // Helper function to create skill point
  const createSkillPoint = (x: number, y: number, z: number, level: number) => {
    const geometry = new THREE.SphereGeometry(0.1 + level * 0.02);
    const material = new THREE.MeshPhongMaterial({
      color: new THREE.Color(1, 1, 1).multiplyScalar(0.2 + level * 0.16),
      emissive: new THREE.Color(0, 1, 1).multiplyScalar(level * 0.2),
    });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.set(x, y, z);
    return sphere;
  };

  return (
    <div 
      ref={containerRef} 
      className="w-full h-[600px] rounded-lg overflow-hidden bg-black"
      style={{ touchAction: 'none' }}
    />
  );
};
