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
    
    targetPositionRef.current.set(
      Math.random() * dimensions.width - halfWidth,
      0,
      Math.random() * dimensions.length - halfLength
    );

    movementTimeoutRef.current = window.setTimeout(generateNewTarget, Math.random() * 5000 + 3000);
  };

  const updateHumanPosition = () => {
    if (!humanRef.current) return;

    const currentPos = humanRef.current.position;
    const targetPos = targetPositionRef.current;
    
    currentPos.x += (targetPos.x - currentPos.x) * 0.02;
    currentPos.z += (targetPos.z - currentPos.z) * 0.02;
    currentPos.y = 0;

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