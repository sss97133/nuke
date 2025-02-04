import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createHumanFigure } from './workspace/HumanFigure';
import { createPTZCamera } from './workspace/PTZCamera';
import { createFixedCameras } from './workspace/FixedCameras';

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
  ptzTracks?: {
    position: {
      x: number;
      y: number;
      z: number;
    };
    length: number;
    speed: number;
    coneAngle: number;
  }[];
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
  ptzTracks = [] 
}: StudioWorkspaceProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const objectsRef = useRef<THREE.Object3D[]>([]);
  const humanRef = useRef<THREE.Group | null>(null);
  const ptzCameraRef = useRef<THREE.Group | null>(null);
  const fixedCamerasRef = useRef<THREE.Group[]>([]);
  const animationFrameRef = useRef<number>();
  const timeRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
    sceneRef.current = scene;

    // Initialize camera
    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(dimensions.length * 1.5, dimensions.height * 1.5, dimensions.width * 1.5);
    cameraRef.current = camera;

    // Initialize renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Add OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0x404040);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // Create room geometry
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
    scene.add(line);
    objectsRef.current.push(line);

    // Create human figure
    humanRef.current = createHumanFigure({ position: humanPosition, scene });

    // Create PTZ camera
    if (ptzTracks && ptzTracks.length > 0) {
      ptzCameraRef.current = createPTZCamera({ 
        track: ptzTracks[0], 
        showCone: cameras.showCone,
        scene 
      });
    }

    // Create fixed cameras
    fixedCamerasRef.current = createFixedCameras({ dimensions, cameras, scene });

    // Animation loop
    const animate = () => {
      timeRef.current += 0.005;
      
      if (humanRef.current) {
        humanRef.current.position.y = humanPosition.y + Math.abs(Math.sin(timeRef.current * 4) * 0.1);
      }

      if (ptzCameraRef.current && humanRef.current && ptzTracks[0]) {
        ptzCameraRef.current.lookAt(humanRef.current.position);
        
        const track = ptzTracks[0];
        const trackPosition = Math.sin(timeRef.current * track.speed) * (track.length / 2);
        ptzCameraRef.current.position.x = track.position.x + trackPosition;
      }

      if (controlsRef.current) {
        controlsRef.current.update();
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      
      cameraRef.current.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [dimensions, humanPosition, cameras, ptzTracks]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-[400px] border border-border rounded-lg shadow-classic"
    />
  );
};