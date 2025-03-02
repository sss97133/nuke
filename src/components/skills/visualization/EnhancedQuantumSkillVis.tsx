
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { Skill, UserSkill } from '@/types/skills';
import { calculateCareerMomentum, calculateQuantumState } from './quantum/QuantumCalculations';
import { categoryColors } from './quantum/QuantumColors';

interface EnhancedQuantumSkillVisProps {
  skills: Skill[];
  userSkills: UserSkill[];
}

export const EnhancedQuantumSkillVis: React.FC<EnhancedQuantumSkillVisProps> = ({ skills, userSkills }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredSkill, setHoveredSkill] = useState<string | null>(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Scene, camera, renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    
    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.z = 15;
    camera.position.y = 5;
    
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true 
    });
    renderer.setSize(
      containerRef.current.clientWidth,
      containerRef.current.clientHeight
    );
    containerRef.current.appendChild(renderer.domElement);
    
    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(10, 10, 10);
    scene.add(pointLight);
    
    // Background stars
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 2000;
    const starPositions = new Float32Array(starCount * 3);
    
    for (let i = 0; i < starCount * 3; i += 3) {
      starPositions[i] = (Math.random() - 0.5) * 100;
      starPositions[i + 1] = (Math.random() - 0.5) * 100;
      starPositions[i + 2] = (Math.random() - 0.5) * 100;
    }
    
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1 });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);
    
    // Group skills by category
    const skillsByCategory = skills.reduce((acc: { [key: string]: Skill[] }, skill) => {
      if (!acc[skill.category]) {
        acc[skill.category] = [];
      }
      acc[skill.category].push(skill);
      return acc;
    }, {});
    
    // Create orbits and particles
    const orbitGroups: THREE.Group[] = [];
    const particleSystems: THREE.Points[] = [];
    const skillMeshes: THREE.Mesh[] = [];
    const skillData: { [key: string]: { mesh: THREE.Mesh, skill: Skill, userSkill?: UserSkill } } = {};
    
    Object.entries(skillsByCategory).forEach(([category, categorySkills], categoryIndex) => {
      const baseRadius = (categoryIndex + 2) * 2;
      const color = categoryColors[category as keyof typeof categoryColors] || new THREE.Color(0xffffff);
      
      // Create orbit group
      const orbitGroup = new THREE.Group();
      scene.add(orbitGroup);
      orbitGroups.push(orbitGroup);
      
      // Create orbit ring
      const orbitGeometry = new THREE.TorusGeometry(baseRadius, 0.02, 16, 100);
      const orbitMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 });
      const orbit = new THREE.Mesh(orbitGeometry, orbitMaterial);
      orbit.rotation.x = Math.PI / 2;
      orbitGroup.add(orbit);
      
      // Label for category
      const categoryDiv = document.createElement('div');
      categoryDiv.className = 'absolute px-2 py-1 bg-black/70 text-white text-xs rounded-md whitespace-nowrap pointer-events-none';
      categoryDiv.textContent = category;
      categoryDiv.style.display = 'none';
      containerRef.current.appendChild(categoryDiv);
      
      // Quantum particles
      const particleGeometry = new THREE.BufferGeometry();
      const particleCount = categorySkills.length * 50;
      const particlePositions = new Float32Array(particleCount * 3);
      const particleColors = new Float32Array(particleCount * 3);
      
      for (let i = 0; i < particleCount; i++) {
        const skillIndex = Math.floor(i / 50);
        const skill = categorySkills[skillIndex];
        const userSkill = userSkills.find(us => us.skill_id === skill.id);
        const level = userSkill?.level || 0;
        
        const angle = (i % 50) * (Math.PI * 2) / 50;
        const radius = baseRadius + (Math.random() - 0.5) * 0.3 * (5 - level) / 5;
        
        particlePositions[i * 3] = Math.cos(angle) * radius;
        particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 0.2 * (5 - level) / 5;
        particlePositions[i * 3 + 2] = Math.sin(angle) * radius;
        
        particleColors[i * 3] = color.r;
        particleColors[i * 3 + 1] = color.g;
        particleColors[i * 3 + 2] = color.b;
      }
      
      particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
      particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));
      
      const particleMaterial = new THREE.PointsMaterial({
        size: 0.05,
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending
      });
      
      const particles = new THREE.Points(particleGeometry, particleMaterial);
      scene.add(particles);
      particleSystems.push(particles);
      
      // Add skill nodes
      categorySkills.forEach((skill, skillIndex) => {
        const userSkill = userSkills.find(us => us.skill_id === skill.id);
        const level = userSkill?.level || 0;
        
        const angle = skillIndex * (Math.PI * 2) / categorySkills.length;
        const position = new THREE.Vector3(
          Math.cos(angle) * baseRadius,
          0,
          Math.sin(angle) * baseRadius
        );
        
        // Create skill node
        const size = 0.1 + (level * 0.05);
        const geometry = new THREE.SphereGeometry(size, 16, 16);
        
        // Adjust material based on skill level
        const material = new THREE.MeshPhongMaterial({
          color,
          emissive: color,
          emissiveIntensity: level ? 0.2 + (level * 0.15) : 0.1,
          transparent: true,
          opacity: level ? 0.7 + (level * 0.06) : 0.4,
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        mesh.userData = { skillId: skill.id, skillName: skill.name, level };
        scene.add(mesh);
        
        skillMeshes.push(mesh);
        skillData[skill.id] = { mesh, skill, userSkill };
      });
    });
    
    // Raycaster for interaction
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    // Create HTML tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'absolute p-2 bg-black/80 text-white text-xs rounded-md pointer-events-none';
    tooltip.style.display = 'none';
    containerRef.current.appendChild(tooltip);
    
    // Mouse move handler for hover effects
    const onMouseMove = (event: MouseEvent) => {
      // Calculate mouse position in normalized device coordinates
      const rect = containerRef.current!.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      
      // Update the raycaster
      raycaster.setFromCamera(mouse, camera);
      
      // Check for intersections with skill nodes
      const intersects = raycaster.intersectObjects(skillMeshes);
      
      if (intersects.length > 0) {
        const intersectedObject = intersects[0].object;
        const { skillId, skillName, level } = intersectedObject.userData;
        
        setHoveredSkill(skillId);
        
        // Update tooltip content and position
        tooltip.innerHTML = `
          <div class="font-medium">${skillName}</div>
          <div class="flex justify-between mt-1">
            <span>Level:</span>
            <span>${level || 'Not started'}</span>
          </div>
        `;
        
        tooltip.style.display = 'block';
        tooltip.style.left = `${event.clientX - rect.left + 10}px`;
        tooltip.style.top = `${event.clientY - rect.top + 10}px`;
        
        // Highlight the hovered skill
        skillMeshes.forEach(mesh => {
          if (mesh.userData.skillId === skillId) {
            (mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = 0.8;
            mesh.scale.set(1.2, 1.2, 1.2);
          } else {
            const originalLevel = mesh.userData.level || 0;
            (mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = originalLevel ? 0.2 + (originalLevel * 0.15) : 0.1;
            mesh.scale.set(1, 1, 1);
          }
        });
        
        document.body.style.cursor = 'pointer';
      } else {
        setHoveredSkill(null);
        tooltip.style.display = 'none';
        
        // Reset all skill nodes
        skillMeshes.forEach(mesh => {
          const originalLevel = mesh.userData.level || 0;
          (mesh.material as THREE.MeshPhongMaterial).emissiveIntensity = originalLevel ? 0.2 + (originalLevel * 0.15) : 0.1;
          mesh.scale.set(1, 1, 1);
        });
        
        document.body.style.cursor = 'default';
      }
    };
    
    containerRef.current.addEventListener('mousemove', onMouseMove);
    
    // Animation
    const animate = () => {
      requestAnimationFrame(animate);
      
      const time = Date.now() * 0.001;
      const spinRate = calculateCareerMomentum(userSkills);
      
      // Update orbit rotations
      orbitGroups.forEach((group, index) => {
        group.rotation.y += spinRate * (1 + index * 0.1);
      });
      
      // Update particle systems
      particleSystems.forEach((particles, systemIndex) => {
        const positions = particles.geometry.attributes.position.array as Float32Array;
        
        for (let i = 0; i < positions.length; i += 3) {
          const index = i / 3;
          const skillIndex = Math.floor(index / 50);
          const category = Object.keys(skillsByCategory)[systemIndex];
          const skill = skillsByCategory[category][skillIndex];
          
          if (!skill) continue;
          
          const userSkill = userSkills.find(us => us.skill_id === skill.id);
          const skillLevel = userSkill?.level || 0;
          
          // Apply quantum fluctuations based on skill level
          const state = calculateQuantumState(skillLevel, time + index);
          const x = positions[i];
          const z = positions[i + 2];
          const radius = Math.sqrt(x * x + z * z);
          const angle = Math.atan2(z, x);
          
          // More stable particles for higher skill levels
          const newAngle = angle + spinRate * (0.5 + Math.sin(time * 0.5) * 0.01) * (6 - skillLevel) / 6;
          const radiusVariation = 0.01 * Math.sin(time * (3 - skillLevel * 0.4) + index) * (6 - skillLevel) / 6;
          
          positions[i] = radius * (1 + radiusVariation) * Math.cos(newAngle);
          positions[i + 1] += Math.sin(time * 2 + index) * 0.002 * (6 - skillLevel) / 6;
          positions[i + 1] *= 0.99; // Gradually return to orbit plane
          positions[i + 2] = radius * (1 + radiusVariation) * Math.sin(newAngle);
        }
        
        particles.geometry.attributes.position.needsUpdate = true;
      });
      
      // Update skill node positions
      Object.values(skillData).forEach(({ mesh, skill, userSkill }) => {
        const categoryIndex = Object.keys(skillsByCategory).findIndex(cat => 
          skillsByCategory[cat].some(s => s.id === skill.id)
        );
        
        const baseRadius = (categoryIndex + 2) * 2;
        const categorySkills = Object.values(skillsByCategory)[categoryIndex];
        const skillIndex = categorySkills.findIndex(s => s.id === skill.id);
        const angle = (skillIndex / categorySkills.length) * Math.PI * 2 + time * spinRate;
        
        mesh.position.x = Math.cos(angle) * baseRadius;
        mesh.position.z = Math.sin(angle) * baseRadius;
        
        // Add subtle bob movement
        const level = userSkill?.level || 0;
        mesh.position.y = Math.sin(time * (1 + level * 0.2)) * 0.05 * (1 + level * 0.2);
      });
      
      controls.update();
      renderer.render(scene, camera);
    };
    
    animate();
    
    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current) return;
      
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    
    window.addEventListener('resize', handleResize);
    
    // Cleanup
    return () => {
      if (containerRef.current) {
        containerRef.current.removeEventListener('mousemove', onMouseMove);
        containerRef.current.removeChild(renderer.domElement);
        
        // Remove tooltips
        const tooltips = containerRef.current.querySelectorAll('div');
        tooltips.forEach(el => el.remove());
      }
      
      window.removeEventListener('resize', handleResize);
      
      // Dispose of geometries and materials
      particleSystems.forEach(particles => {
        particles.geometry.dispose();
        (particles.material as THREE.Material).dispose();
      });
      
      skillMeshes.forEach(mesh => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    };
  }, [skills, userSkills]);
  
  return (
    <div 
      ref={containerRef} 
      className="relative w-full h-[600px] rounded-md overflow-hidden"
      aria-live="polite"
      aria-label={
        hoveredSkill ? 
          `Quantum visualization with ${skills.find(s => s.id === hoveredSkill)?.name} selected` : 
          'Quantum skill visualization'
      }
    />
  );
};
