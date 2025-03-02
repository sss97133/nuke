
import { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import type { PTZTrack } from '../types/workspace';

export const useStudioAnimation = (
  humanRef: React.MutableRefObject<THREE.Group | null>,
  ptzCamerasRef: React.MutableRefObject<THREE.Group[]>,
  ptzTracks: PTZTrack[],
  dimensions: { length: number; width: number; height: number },
  isPlaying: boolean = true
) => {
  const timeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>();
  const [timeMultiplier, setTimeMultiplier] = useState<number>(1);
  
  // Function to reset animation state
  const resetAnimation = () => {
    timeRef.current = 0;
    
    // Reset human position
    if (humanRef.current) {
      humanRef.current.position.x = 0;
      humanRef.current.position.z = 0;
      humanRef.current.position.y = humanRef.current.position.y;
      humanRef.current.rotation.y = 0;
    }
    
    // Reset camera positions
    ptzCamerasRef.current.forEach((ptzCamera, index) => {
      if (ptzCamera && ptzTracks[index]) {
        const track = ptzTracks[index];
        ptzCamera.position.x = track.position.x;
        ptzCamera.lookAt(new THREE.Vector3(0, 0, 0));
      }
    });
  };

  useEffect(() => {
    // Main animation loop
    const animate = () => {
      // Only update time if animation is playing
      if (isPlaying) {
        timeRef.current += 0.005 * timeMultiplier;
      }
      
      // Animate human walking in a figure-8 pattern
      if (humanRef.current) {
        const walkRadiusX = Math.min(dimensions.length, dimensions.width) / 3;
        const walkRadiusZ = Math.min(dimensions.length, dimensions.width) / 2.5;
        
        // Figure-8 pattern using sin and cos with different frequencies
        const t = timeRef.current;
        humanRef.current.position.x = Math.sin(t) * walkRadiusX;
        humanRef.current.position.z = Math.sin(t * 2) * walkRadiusZ;
        
        // Add subtle up/down movement for more realism
        humanRef.current.position.y = dimensions.height/2 + Math.sin(t * 8) * 0.1;
        
        // Face the direction of travel
        const dx = Math.cos(t) * walkRadiusX;
        const dz = Math.cos(t * 2) * 2 * walkRadiusZ;
        humanRef.current.rotation.y = Math.atan2(dx, dz);
        
        // Add subtle body rotation for walking
        humanRef.current.rotation.x = Math.sin(t * 8) * 0.05;
        
        // Animate arms and legs if available
        const children = humanRef.current.children;
        children.forEach(child => {
          // Identify limbs by their position
          if (child.position.y < 0 && Math.abs(child.position.x) > 0.3) {
            // This is a leg - add walking motion
            if (child.position.x > 0) {
              // Left leg
              child.rotation.x = Math.sin(t * 8) * 0.5;
            } else {
              // Right leg - opposite phase
              child.rotation.x = Math.sin(t * 8 + Math.PI) * 0.5;
            }
          } else if (child.position.y > 0 && Math.abs(child.position.x) > 0.8) {
            // This is an arm - add swinging motion
            if (child.position.x > 0) {
              // Left arm
              child.rotation.x = Math.sin(t * 8 + Math.PI) * 0.4;
            } else {
              // Right arm - opposite phase
              child.rotation.x = Math.sin(t * 8) * 0.4;
            }
          }
        });
      }

      // Animate PTZ cameras to track the human with some lag/smoothing
      ptzCamerasRef.current.forEach((ptzCamera, index) => {
        if (ptzCamera && humanRef.current && ptzTracks[index]) {
          const track = ptzTracks[index];
          
          // Calculate the target the camera should look at
          const targetPosition = humanRef.current.position.clone();
          
          // Smooth camera movement (lerp) for a more realistic following effect
          const currentLookAt = new THREE.Vector3();
          ptzCamera.getWorldDirection(currentLookAt);
          currentLookAt.multiplyScalar(-1); // Convert direction to look-at point
          currentLookAt.add(ptzCamera.position);
          
          // Interpolate between current and target position
          const lerpFactor = 0.05 * track.speed; // Adjust based on camera speed
          const smoothedTarget = new THREE.Vector3().lerpVectors(
            currentLookAt, 
            targetPosition, 
            lerpFactor
          );
          
          // Make camera look at the smoothed target
          ptzCamera.lookAt(smoothedTarget);
          
          // Move camera along track based on time
          const trackPosition = Math.sin(timeRef.current * track.speed) * (track.length / 2);
          
          // Smooth position changes
          const targetX = track.position.x + trackPosition;
          ptzCamera.position.x += (targetX - ptzCamera.position.x) * 0.1;
          
          // Add subtle vertical movement
          ptzCamera.position.y = track.position.y + Math.sin(timeRef.current * 1.5) * 0.2;
        }
      });

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [dimensions, ptzTracks, humanRef, ptzCamerasRef, isPlaying, timeMultiplier]);

  return { 
    timeRef, 
    setTimeMultiplier,
    resetAnimation,
    animationFrameRef
  };
};
