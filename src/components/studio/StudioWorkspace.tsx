
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useStudioScene } from './hooks/useStudioScene';
import { useStudioAnimation } from './hooks/useStudioAnimation';
import { createHuman } from './components/HumanFigure';
import { createPTZCamera } from './components/PTZCamera';
import type { StudioWorkspaceProps } from './types/workspace';

export const StudioWorkspace = ({ dimensions, ptzTracks = [] }: StudioWorkspaceProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const objectsRef = useRef<THREE.Object3D[]>([]);
  const ptzCamerasRef = useRef<THREE.Group[]>([]);
  const humanRef = useRef<THREE.Group | null>(null);

  const { sceneRef, cameraRef, rendererRef, controlsRef } = useStudioScene(containerRef, dimensions);
  const { resetAnimation } = useStudioAnimation(humanRef, ptzCamerasRef, ptzTracks, dimensions);

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
    ptzTracks.forEach((track, index) => {
      const maxDistance = Math.max(dimensions.length, dimensions.width) * 2;
      const isActive = index === 0; // Make the first camera active
      const { trackMesh, ptzGroup } = createPTZCamera(sceneRef.current!, track, maxDistance, isActive);
      objectsRef.current.push(trackMesh);
      ptzCamerasRef.current.push(ptzGroup);
    });

    const animate = () => {
      if (controlsRef.current) {
        controlsRef.current.update();
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }

      requestAnimationFrame(animate);
    };

    animate();
  }, [dimensions, ptzTracks]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-[400px] border border-border rounded-lg shadow-classic"
    />
  );
};
