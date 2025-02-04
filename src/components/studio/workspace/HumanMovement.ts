import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export const useHumanMovement = (
  dimensions: { width: number; length: number },
  humanRef: React.MutableRefObject<THREE.Group | null>
) => {
  const targetPositionRef = useRef(new THREE.Vector3(0, 0, 0));
  const movementTimeoutRef = useRef<number>();

  const generateNewTarget = () => {
    const halfWidth = dimensions.width / 2;
    const halfLength = dimensions.length / 2;
    
    // More controlled movement - smaller steps
    const currentPos = humanRef.current?.position || new THREE.Vector3();
    const maxStep = 5; // Maximum distance to move
    
    const newX = currentPos.x + (Math.random() * 2 - 1) * maxStep;
    const newZ = currentPos.z + (Math.random() * 2 - 1) * maxStep;
    
    targetPositionRef.current.set(
      Math.max(-halfWidth + 1, Math.min(halfWidth - 1, newX)),
      0,
      Math.max(-halfLength + 1, Math.min(halfLength - 1, newZ))
    );

    // Longer interval between movements
    movementTimeoutRef.current = window.setTimeout(generateNewTarget, 5000 + Math.random() * 3000);
  };

  const updateHumanPosition = () => {
    if (!humanRef.current) return;

    const currentPos = humanRef.current.position;
    const targetPos = targetPositionRef.current;
    
    // Slower, more controlled movement
    const speed = 0.01;
    currentPos.x += (targetPos.x - currentPos.x) * speed;
    currentPos.z += (targetPos.z - currentPos.z) * speed;
    currentPos.y = 0;

    // Ensure we stay within bounds
    currentPos.x = Math.max(-dimensions.width/2 + 1, Math.min(dimensions.width/2 - 1, currentPos.x));
    currentPos.z = Math.max(-dimensions.length/2 + 1, Math.min(dimensions.length/2 - 1, currentPos.z));
  };

  useEffect(() => {
    generateNewTarget();
    return () => {
      if (movementTimeoutRef.current) {
        clearTimeout(movementTimeoutRef.current);
      }
    };
  }, [dimensions]);

  return { updateHumanPosition };
};