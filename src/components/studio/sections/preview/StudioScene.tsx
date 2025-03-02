
import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBasicStudioLighting, createProductLighting, createVisualizationLighting } from '@/components/studio/utils/studioLighting';
import { createWireframeRoom, createHumanFigure, createCNCTracks } from './scene-utils/BasicElements';
import { createCameraModels, updateCameraModels } from './scene-utils/CameraModels';
import { setupThreeJsScene, setupEventHandlers } from './scene-utils/SceneSetup';
import type { WorkspaceDimensions, PTZTrack } from '../../types/workspace';

interface StudioSceneProps {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
  selectedCameraIndex: number | null;
  onCameraSelect: (index: number) => void;
  lightMode: 'basic' | 'product' | 'visualization';
}

export const StudioScene: React.FC<StudioSceneProps> = ({
  dimensions,
  ptzTracks,
  selectedCameraIndex,
  onCameraSelect,
  lightMode
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraModelsRef = useRef<THREE.Group[]>([]);
  const trackModelsRef = useRef<THREE.Line[]>([]);
  const coneModelsRef = useRef<THREE.Mesh[]>([]);
  const cleanupRef = useRef<() => void>(() => {});

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    // Setup basic Three.js components
    const { scene, camera, renderer, controls } = setupThreeJsScene(containerRef) || {};
    if (!scene || !camera || !renderer || !controls) return;
    
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;
    
    // Create wireframe studio room
    createWireframeRoom(scene, dimensions);
    
    // Create CNC tracks along the walls and ceiling
    const tracks = createCNCTracks(scene, dimensions);
    trackModelsRef.current = tracks;
    
    // Add a reference object in the center
    const humanFigure = createHumanFigure();
    scene.add(humanFigure);

    // Create camera models
    const { cameraModels, coneMeshes } = createCameraModels(
      scene, 
      ptzTracks, 
      selectedCameraIndex, 
      onCameraSelect
    );
    cameraModelsRef.current = cameraModels;
    coneModelsRef.current = coneMeshes;

    // Apply lighting based on mode
    applyLighting(scene, lightMode);
    
    // Setup event handlers
    const { cleanup } = setupEventHandlers(
      containerRef,
      camera,
      scene,
      renderer,
      onCameraSelect
    );
    cleanupRef.current = cleanup;

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      
      if (controlsRef.current) {
        controlsRef.current.update();
      }
      
      if (rendererRef.current && cameraRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // Cleanup function
    return () => {
      cleanupRef.current();
      
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
  }, [dimensions, ptzTracks, onCameraSelect]);

  // Update lighting when lightMode changes
  useEffect(() => {
    if (!sceneRef.current) return;
    applyLighting(sceneRef.current, lightMode);
  }, [lightMode]);

  // Update camera positions when ptzTracks or selection changes
  useEffect(() => {
    if (!sceneRef.current) return;
    
    updateCameraModels(
      cameraModelsRef.current,
      coneModelsRef.current,
      ptzTracks,
      selectedCameraIndex
    );
  }, [ptzTracks, selectedCameraIndex]);

  // Helper function to apply lighting based on mode
  const applyLighting = (scene: THREE.Scene, mode: 'basic' | 'product' | 'visualization') => {
    switch (mode) {
      case 'basic':
        createBasicStudioLighting(scene);
        break;
      case 'product':
        createProductLighting(scene);
        break;
      case 'visualization':
        createVisualizationLighting(scene);
        break;
      default:
        createBasicStudioLighting(scene);
    }
  };

  return (
    <div 
      ref={containerRef} 
      className="w-full aspect-video bg-white rounded-md overflow-hidden"
    />
  );
};
