
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useStudioScene } from './hooks/useStudioScene';
import { createHuman } from './components/HumanFigure';
import { createPTZCamera } from './components/PTZCamera';
import type { StudioWorkspaceProps } from './types/workspace';

export const StudioWorkspace = ({ dimensions, ptzTracks = [] }: StudioWorkspaceProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const objectsRef = useRef<THREE.Object3D[]>([]);
  const ptzCamerasRef = useRef<THREE.Group[]>([]);
  const humanRef = useRef<THREE.Group | null>(null);
  const animationFrameRef = useRef<number>();
  const timeRef = useRef<number>(0);

  const { sceneRef, cameraRef, rendererRef, controlsRef } = useStudioScene(containerRef, dimensions);

  useEffect(() => {
    if (!sceneRef.current) return;

    // Remove old objects
    objectsRef.current.forEach(obj => sceneRef.current?.remove(obj));
    objectsRef.current = [];
    
    // Clear old PTZ cameras
    ptzCamerasRef.current.forEach(camera => sceneRef.current?.remove(camera));
    ptzCamerasRef.current = [];

    // Add room geometry
    const roomGeometry = new THREE.BoxGeometry(
      dimensions.width,
      dimensions.height,
      dimensions.length
    );
    const edges = new THREE.EdgesGeometry(roomGeometry);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x000000 })
    );
    sceneRef.current.add(line);
    objectsRef.current.push(line);

    // Add grid helper
    const gridHelper = new THREE.GridHelper(Math.max(dimensions.width, dimensions.length), 10);
    gridHelper.position.y = -dimensions.height / 2;
    sceneRef.current.add(gridHelper);
    objectsRef.current.push(gridHelper);

    // Add human figure
    humanRef.current = createHuman(sceneRef.current);

    // Add PTZ tracks and cameras
    ptzTracks.forEach(track => {
      const maxDistance = Math.max(dimensions.length, dimensions.width) * 2;
      const { trackMesh, ptzGroup } = createPTZCamera(sceneRef.current!, track, maxDistance);
      objectsRef.current.push(trackMesh);
      ptzCamerasRef.current.push(ptzGroup);
    });

    // Animation loop
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

      if (controlsRef.current) {
        controlsRef.current.update();
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [dimensions, ptzTracks]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-[400px] border border-border rounded-lg shadow-classic"
    />
  );
};
