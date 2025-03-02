
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Skill, UserSkill } from '@/types/skills';
import { categoryColors } from './quantum/QuantumColors';
import { 
  calculateCareerMomentum, 
  calculateQuantumState,
  calculateProbabilityDensity,
  calculateSuperpositionState
} from './quantum/QuantumCalculations';

interface EnhancedQuantumSkillVisProps {
  skills: Skill[];
  userSkills: UserSkill[];
}

export const EnhancedQuantumSkillVis: React.FC<EnhancedQuantumSkillVisProps> = ({ 
  skills, 
  userSkills 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const skillObjectsRef = useRef<THREE.Group>(new THREE.Group());
  const orbitLinesRef = useRef<THREE.Line[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hoveredSkill, setHoveredSkill] = useState<string | null>(null);
  
  // Initialize the scene
  useEffect(() => {
    if (!containerRef.current || isInitialized) return;
    
    // Create scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x000c18);
    
    // Add fog for depth effect
    scene.fog = new THREE.FogExp2(0x000c18, 0.0015);
    
    // Create camera
    const camera = new THREE.PerspectiveCamera(
      60, 
      containerRef.current.clientWidth / containerRef.current.clientHeight, 
      0.1, 
      1000
    );
    cameraRef.current = camera;
    camera.position.set(0, 15, 30);
    camera.lookAt(0, 0, 0);
    
    // Create renderer
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true 
    });
    rendererRef.current = renderer;
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    
    // Add orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.5;
    controls.maxDistance = 100;
    controls.minDistance = 5;
    
    // Add light
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    
    // Add central star effect
    const centralGeometry = new THREE.SphereGeometry(2, 32, 32);
    const centralMaterial = new THREE.MeshPhongMaterial({
      color: 0x0088ff,
      emissive: 0x0044aa,
      transparent: true,
      opacity: 0.8
    });
    const centralSphere = new THREE.Mesh(centralGeometry, centralMaterial);
    scene.add(centralSphere);
    
    // Add glow effect
    const glowGeometry = new THREE.SphereGeometry(2.5, 32, 32);
    const glowMaterial = new THREE.MeshPhongMaterial({
      color: 0x0088ff,
      emissive: 0x0066cc,
      transparent: true,
      opacity: 0.3
    });
    const glowSphere = new THREE.Mesh(glowGeometry, glowMaterial);
    scene.add(glowSphere);
    
    // Add skill objects group
    scene.add(skillObjectsRef.current);
    
    // Add grid helper for reference
    const gridHelper = new THREE.GridHelper(50, 50, 0x222222, 0x080808);
    scene.add(gridHelper);
    
    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      
      if (controlsRef.current) {
        controlsRef.current.update();
      }
      
      // Rotate central sphere
      centralSphere.rotation.y += 0.005;
      glowSphere.rotation.y -= 0.003;
      
      // Pulse effect
      const time = Date.now() * 0.001;
      const pulseScale = 1 + 0.05 * Math.sin(time * 0.5);
      glowSphere.scale.set(pulseScale, pulseScale, pulseScale);
      
      // Render
      if (cameraRef.current && rendererRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    
    animate();
    setIsInitialized(true);
    
    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };
    
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      
      if (containerRef.current && rendererRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      
      if (controlsRef.current) {
        controlsRef.current.dispose();
      }
      
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
    };
  }, [isInitialized]);
  
  // Create skill orbitals whenever skills or userSkills change
  useEffect(() => {
    if (!sceneRef.current || !isInitialized || !skills.length) return;
    
    // Clear previous skill objects
    while (skillObjectsRef.current.children.length > 0) {
      skillObjectsRef.current.remove(skillObjectsRef.current.children[0]);
    }
    
    // Clear previous orbit lines
    orbitLinesRef.current.forEach(line => {
      if (sceneRef.current) sceneRef.current.remove(line);
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
      sceneRef.current.add(orbit);
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
        
        // Create a label for the particle
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
        }
        
        skillObjectsRef.current.add(skillGroup);
      });
    });
    
    // Animation setup for skill movement
    const animateSkills = () => {
      const time = Date.now() * 0.001;
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
      
      // Continue animation loop
      requestAnimationFrame(animateSkills);
    };
    
    // Start animation
    animateSkills();
  }, [skills, userSkills, isInitialized]);
  
  // Create raycaster for interactivity
  useEffect(() => {
    if (!isInitialized || !containerRef.current) return;
    
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    const onMouseMove = (event: MouseEvent) => {
      if (!containerRef.current || !cameraRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / containerRef.current.clientWidth) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / containerRef.current.clientHeight) * 2 + 1;
      
      raycaster.setFromCamera(mouse, cameraRef.current);
      
      const intersects = raycaster.intersectObjects(skillObjectsRef.current.children, true);
      
      if (intersects.length > 0) {
        // Find the parent group (skill) that was intersected
        let object = intersects[0].object;
        let parent = object.parent;
        
        while (parent && !(parent instanceof THREE.Group && parent.userData.skillId)) {
          object = parent;
          parent = object.parent;
        }
        
        if (parent && parent.userData.skillId) {
          setHoveredSkill(parent.userData.skillId);
          document.body.style.cursor = 'pointer';
          
          // Highlight effect
          object.scale.set(1.2, 1.2, 1.2);
        }
      } else {
        setHoveredSkill(null);
        document.body.style.cursor = 'default';
        
        // Reset scales
        skillObjectsRef.current.children.forEach(group => {
          if (group.children.length > 0) {
            group.children[0].scale.set(1, 1, 1);
          }
        });
      }
    };
    
    containerRef.current.addEventListener('mousemove', onMouseMove);
    
    return () => {
      if (containerRef.current) {
        containerRef.current.removeEventListener('mousemove', onMouseMove);
      }
      document.body.style.cursor = 'default';
    };
  }, [isInitialized]);
  
  return (
    <div className="relative">
      <div 
        ref={containerRef} 
        className="w-full h-[500px] rounded-lg overflow-hidden" 
      />
      
      {hoveredSkill && (
        <div className="absolute bottom-4 left-4 bg-background/80 backdrop-blur-sm p-3 rounded-md border shadow-lg">
          <div className="text-sm font-medium">
            {skills.find(s => s.id === hoveredSkill)?.name}
          </div>
          <div className="text-xs text-muted-foreground">
            Level: {userSkills.find(us => us.skill_id === hoveredSkill)?.level || 0}
          </div>
        </div>
      )}
    </div>
  );
};
