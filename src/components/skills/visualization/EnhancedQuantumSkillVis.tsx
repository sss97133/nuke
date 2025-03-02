
import React, { useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Skill, UserSkill } from '@/types/skills';
import SceneInitializer from './quantum/components/SceneInitializer';
import CentralStar from './quantum/components/CentralStar';
import SceneLighting from './quantum/components/SceneLighting';
import SkillOrbitals from './quantum/components/SkillOrbitals';
import SkillInteractions from './quantum/components/SkillInteractions';
import { useQuantumAnimation } from './quantum/hooks/useQuantumAnimation';

interface EnhancedQuantumSkillVisProps {
  skills: Skill[];
  userSkills: UserSkill[];
}

export const EnhancedQuantumSkillVis: React.FC<EnhancedQuantumSkillVisProps> = ({ 
  skills, 
  userSkills 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const skillObjectsGroupRef = useRef<THREE.Group>(new THREE.Group());
  const centralStarRef = useRef<{ animate: () => void } | null>(null);
  const skillOrbitalsRef = useRef<{ 
    animateSkills: (time: number) => void, 
    skillObjectsRef: React.RefObject<THREE.Group> 
  } | null>(null);
  
  const [isInitialized, setIsInitialized] = useState(false);
  const [hoveredSkill, setHoveredSkill] = useState<string | null>(null);
  
  const { refs, startAnimation, setSceneRefs } = useQuantumAnimation();
  
  // Handle scene initialization
  const handleSceneCreated = useCallback((
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    controls: OrbitControls
  ) => {
    setSceneRefs(scene, camera, renderer, controls);
    setIsInitialized(true);
  }, [setSceneRefs]);
  
  // Set up animation loop
  useEffect(() => {
    if (!isInitialized || !refs.scene) return;
    
    const animate = (time: number) => {
      // Animate central star
      if (centralStarRef.current) {
        centralStarRef.current.animate();
      }
      
      // Animate skill orbitals
      if (skillOrbitalsRef.current) {
        skillOrbitalsRef.current.animateSkills(time);
      }
    };
    
    const stopAnimation = startAnimation(animate);
    return stopAnimation;
  }, [isInitialized, refs.scene, startAnimation]);
  
  // Initialize components after scene is ready
  useEffect(() => {
    if (!isInitialized || !refs.scene) return;
    
    // Add central star
    const centralStarComponent = CentralStar({ scene: refs.scene });
    centralStarRef.current = centralStarComponent;
    
    return () => {
      centralStarRef.current = null;
    };
  }, [isInitialized, refs.scene]);
  
  // Pass hovered skill state change handler
  const handleHoveredSkillChange = useCallback((skillId: string | null) => {
    setHoveredSkill(skillId);
  }, []);
  
  return (
    <div className="relative">
      <div 
        ref={containerRef} 
        className="w-full h-[500px] rounded-lg overflow-hidden" 
      />
      
      {isInitialized && refs.scene && (
        <>
          <SceneLighting scene={refs.scene} />
          
          {skills.length > 0 && userSkills.length > 0 && (
            <>
              {/* Create the skill orbitals */}
              <div ref={(el) => {
                if (el) {
                  // Initialize components
                  const skillOrbitalsComponent = SkillOrbitals({ 
                    scene: refs.scene!, 
                    skills, 
                    userSkills 
                  });
                  
                  // Store references to the animation methods and objects
                  if (el) {
                    skillOrbitalsRef.current = {
                      animateSkills: (el as any).animateSkills,
                      skillObjectsRef: (el as any).skillObjectsRef
                    };
                  }
                }
              }}>
                <SkillOrbitals 
                  scene={refs.scene} 
                  skills={skills} 
                  userSkills={userSkills} 
                />
              </div>
              
              {refs.camera && skillOrbitalsRef.current && (
                <SkillInteractions
                  containerRef={containerRef}
                  camera={refs.camera}
                  skillObjectsRef={skillOrbitalsRef.current.skillObjectsRef}
                  onHoveredSkillChange={handleHoveredSkillChange}
                />
              )}
            </>
          )}
        </>
      )}
      
      {!isInitialized && (
        <SceneInitializer
          containerRef={containerRef}
          onSceneCreated={handleSceneCreated}
        />
      )}
      
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
