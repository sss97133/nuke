
import React, { useEffect, useState } from 'react';
import * as THREE from 'three';

interface SkillInteractionsProps {
  containerRef: React.RefObject<HTMLDivElement>;
  camera: THREE.PerspectiveCamera | null;
  skillObjectsRef: React.RefObject<THREE.Group>;
  onHoveredSkillChange: (skillId: string | null) => void;
}

const SkillInteractions: React.FC<SkillInteractionsProps> = ({
  containerRef,
  camera,
  skillObjectsRef,
  onHoveredSkillChange
}) => {
  useEffect(() => {
    if (!containerRef.current || !camera || !skillObjectsRef.current) return;
    
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    const onMouseMove = (event: MouseEvent) => {
      if (!containerRef.current || !camera) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / containerRef.current.clientWidth) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / containerRef.current.clientHeight) * 2 + 1;
      
      raycaster.setFromCamera(mouse, camera);
      
      if (!skillObjectsRef.current) return;
      
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
          onHoveredSkillChange(parent.userData.skillId);
          document.body.style.cursor = 'pointer';
          
          // Highlight effect
          object.scale.set(1.2, 1.2, 1.2);
        }
      } else {
        onHoveredSkillChange(null);
        document.body.style.cursor = 'default';
        
        // Reset scales
        if (skillObjectsRef.current) {
          skillObjectsRef.current.children.forEach(group => {
            if (group.children.length > 0) {
              group.children[0].scale.set(1, 1, 1);
            }
          });
        }
      }
    };
    
    containerRef.current.addEventListener('mousemove', onMouseMove);
    
    return () => {
      if (containerRef.current) {
        containerRef.current.removeEventListener('mousemove', onMouseMove);
      }
      document.body.style.cursor = 'default';
    };
  }, [containerRef, camera, skillObjectsRef, onHoveredSkillChange]);

  return null;
};

export default SkillInteractions;
