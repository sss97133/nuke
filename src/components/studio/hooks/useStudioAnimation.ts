
import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { PTZTrack } from '../types/workspace';

export const useStudioAnimation = (
  humanRef: React.MutableRefObject<THREE.Group | null>,
  ptzCamerasRef: React.MutableRefObject<THREE.Group[]>,
  ptzTracks: PTZTrack[],
  dimensions: { length: number; width: number }
) => {
  const timeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    const animate = () => {
      timeRef.current += 0.005;
      
      if (humanRef.current) {
        const walkRadius = Math.min(dimensions.length, dimensions.width) / 2 - 2;
        humanRef.current.position.x = Math.sin(timeRef.current) * walkRadius;
        humanRef.current.position.z = Math.cos(timeRef.current * 0.7) * walkRadius;
        humanRef.current.position.y = Math.sin(timeRef.current * 4) * 0.1;
      }

      ptzCamerasRef.current.forEach((ptzCamera, index) => {
        if (ptzCamera && humanRef.current && ptzTracks[index]) {
          ptzCamera.lookAt(humanRef.current.position);
          const track = ptzTracks[index];
          const trackPosition = Math.sin(timeRef.current * track.speed) * (track.length / 2);
          ptzCamera.position.x = track.position.x + trackPosition;
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
  }, [dimensions, ptzTracks, humanRef, ptzCamerasRef]);

  return { timeRef, animationFrameRef };
};

