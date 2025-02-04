import * as THREE from 'three';
import type { PTZTrack } from '../types';

export const useCameraSystem = (
  ptzCameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>,
  humanRef: React.MutableRefObject<THREE.Group | null>,
  ptzTracks: PTZTrack[],
  timeRef: React.MutableRefObject<number>
) => {
  const updateCameras = () => {
    if (ptzCameraRef.current && humanRef.current && ptzTracks[0]) {
      const track = ptzTracks[0];
      ptzCameraRef.current.lookAt(humanRef.current.position);
      
      const trackPosition = Math.sin(timeRef.current * track.speed) * (track.length / 2);
      ptzCameraRef.current.position.x = track.position.x + trackPosition;
    }
  };

  return { updateCameras };
};