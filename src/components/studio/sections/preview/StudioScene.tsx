
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { setupThreeJsScene, setupEventHandlers, setupFieldOfViewControls } from './scene-utils/SceneSetup';
import { createWalls, createFloor } from './scene-utils/BasicElements';
import { createCameraModels } from './scene-utils/CameraModels';
import type { WorkspaceDimensions, PTZTrack } from '../../types/workspace';

interface StudioSceneProps {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
  selectedCameraIndex: number | null;
  onCameraSelect: (index: number) => void;
  lightMode: 'basic' | 'product' | 'visualization';
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export const StudioScene: React.FC<StudioSceneProps> = ({
  dimensions,
  ptzTracks,
  selectedCameraIndex,
  onCameraSelect,
  lightMode,
  onZoomIn,
  onZoomOut
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<any>(null);
  const cameraModelsRef = useRef<THREE.Group[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;

    // Setup scene, camera, renderer, and controls
    const { scene, camera, renderer, controls } = setupThreeJsScene(containerRef) || {};
    if (!scene || !camera || !renderer || !controls) return;

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;

    // Setup basic environment
    createFloor(scene, dimensions);
    createWalls(scene, dimensions);

    // Setup initial lighting
    setupLighting(scene, 'basic');

    // Setup event handlers and cleanup
    const { cleanup } = setupEventHandlers(containerRef, camera, scene, renderer, onCameraSelect);
    cleanupRef.current = cleanup;

    // Setup field of view controls for zooming
    const { zoomIn, zoomOut } = setupFieldOfViewControls(camera, ptzTracks, selectedCameraIndex);
    
    // Expose zoom functions to the window object for external access
    (window as any).zoomIn = zoomIn;
    (window as any).zoomOut = zoomOut;

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Cleanup function
    return () => {
      cleanup && cleanup();
      if (renderer && containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      (window as any).zoomIn = undefined;
      (window as any).zoomOut = undefined;
    };
  }, [dimensions]);

  // Update camera models when ptzTracks or selectedCamera changes
  useEffect(() => {
    if (!sceneRef.current) return;
    
    // Remove existing camera models
    cameraModelsRef.current.forEach(model => {
      sceneRef.current?.remove(model);
    });
    
    // Create new camera models
    cameraModelsRef.current = createCameraModels(
      sceneRef.current, 
      ptzTracks, 
      selectedCameraIndex, 
      onCameraSelect
    );
  }, [ptzTracks, selectedCameraIndex, onCameraSelect]);

  // Handle lighting mode changes
  useEffect(() => {
    if (!sceneRef.current) return;
    setupLighting(sceneRef.current, lightMode);
  }, [lightMode]);

  // Setup different lighting scenarios based on the selected mode
  const setupLighting = (scene: THREE.Scene, mode: 'basic' | 'product' | 'visualization') => {
    // Remove existing lights
    scene.children.forEach(child => {
      // Check if the object is a light
      if (child instanceof THREE.Light) {
        scene.remove(child);
      }
    });

    // Create new lights based on the selected mode
    switch (mode) {
      case 'basic':
        // Basic lighting setup
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
        mainLight.position.set(5, 10, 7);
        mainLight.castShadow = true;
        scene.add(mainLight);
        break;

      case 'product':
        // Product photography style lighting
        const softAmbient = new THREE.AmbientLight(0xffffff, 0.3);
        scene.add(softAmbient);

        // Key light (main light)
        const keyLight = new THREE.DirectionalLight(0xffffff, 1);
        keyLight.position.set(5, 5, 5);
        keyLight.castShadow = true;
        scene.add(keyLight);

        // Fill light (softer light from opposite side)
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
        fillLight.position.set(-5, 3, 5);
        scene.add(fillLight);

        // Rim light (highlight edges)
        const rimLight = new THREE.DirectionalLight(0xffffff, 0.7);
        rimLight.position.set(0, 5, -5);
        scene.add(rimLight);
        break;

      case 'visualization':
        // Enhanced visualization lighting
        const brightAmbient = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(brightAmbient);

        const overheadLight = new THREE.DirectionalLight(0xffffff, 0.8);
        overheadLight.position.set(0, 10, 0);
        overheadLight.castShadow = true;
        scene.add(overheadLight);

        // Add colored point lights for visual interest
        const redLight = new THREE.PointLight(0xff0000, 0.5, 10);
        redLight.position.set(-5, 2, -5);
        scene.add(redLight);

        const blueLight = new THREE.PointLight(0x0000ff, 0.5, 10);
        blueLight.position.set(5, 2, -5);
        scene.add(blueLight);
        break;
    }
  };

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {/* Three.js canvas will be injected here */}
    </div>
  );
};
