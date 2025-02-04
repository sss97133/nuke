import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createHumanFigure } from './workspace/HumanFigure';
import { createFixedCameras } from './workspace/FixedCameras';
import { createProps } from './workspace/Props';
import { useHumanMovement } from './workspace/HumanMovement';
import { useCameraSystem } from './workspace/CameraSystem';
import type { PTZTrack } from './types';

interface StudioWorkspaceProps {
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  humanPosition?: {
    x: number;
    y: number;
    z: number;
  };
  cameras?: {
    frontWall: boolean;
    backWall: boolean;
    leftWall: boolean;
    rightWall: boolean;
    ceiling: boolean;
    showCone: boolean;
  };
  props?: {
    toolBox: boolean;
    carLift: boolean;
    car: boolean;
  };
  ptzTracks: PTZTrack[];
}

export const StudioWorkspace = ({ 
  dimensions, 
  humanPosition = { x: 0, y: 0, z: 0 },
  cameras = {
    frontWall: false,
    backWall: false,
    leftWall: false,
    rightWall: false,
    ceiling: false,
    showCone: true,
  },
  props = {
    toolBox: false,
    carLift: false,
    car: false,
  },
  ptzTracks = []
}: StudioWorkspaceProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer>();
  const sceneRef = useRef<THREE.Scene>();
  const cameraRef = useRef<THREE.PerspectiveCamera>();
  const controlsRef = useRef<OrbitControls>();
  const humanRef = useRef<THREE.Group | null>(null);
  const ptzCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const fixedCamerasRef = useRef<THREE.Group[]>([]);
  const propsRef = useRef<THREE.Group[]>([]);
  const objectsRef = useRef<(THREE.Mesh | THREE.GridHelper)[]>([]);
  const animationFrameRef = useRef<number>();
  const timeRef = useRef<number>(0);

  const { updateHumanPosition } = useHumanMovement(dimensions, humanRef);
  const { updateCameras } = useCameraSystem(ptzCameraRef, humanRef, ptzTracks, timeRef);

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(75, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 1000);
    camera.position.set(10, 10, 10);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls setup
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;

    // Room setup
    const roomGeometry = new THREE.BoxGeometry(dimensions.width, dimensions.height, dimensions.length);
    const roomMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xcccccc,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.3
    });
    const room = new THREE.Mesh(roomGeometry, roomMaterial);
    scene.add(room);
    objectsRef.current.push(room);

    // Floor grid
    const gridHelper = new THREE.GridHelper(Math.max(dimensions.width, dimensions.length), 20);
    scene.add(gridHelper);
    objectsRef.current.push(gridHelper);

    // Create human figure
    humanRef.current = createHumanFigure({ 
      position: humanPosition,
      scene,
      dimensions 
    });

    // Create fixed cameras and props
    fixedCamerasRef.current = createFixedCameras({ dimensions, cameras, scene });
    propsRef.current = createProps({ props, dimensions, scene });

    // Animation loop
    const animate = () => {
      timeRef.current += 0.005;
      
      updateHumanPosition();
      updateCameras();

      if (controlsRef.current) {
        controlsRef.current.update();
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    // Cleanup
    return () => {
      if (containerRef.current && rendererRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }

      objectsRef.current.forEach(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach(mat => mat.dispose());
          } else if (obj.material) {
            obj.material.dispose();
          }
        }
      });

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [dimensions, humanPosition, cameras, props, ptzTracks]);

  return (
    <div 
      ref={containerRef}
      className="w-full h-[400px] border border-border rounded-lg shadow-classic"
    />
  );
};