import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createHumanFigure } from './workspace/HumanFigure';
import { createPTZCamera } from './workspace/PTZCamera';
import { createFixedCameras } from './workspace/FixedCameras';
import { createProps } from './workspace/Props';

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
  props = {
    toolBox: false,
    carLift: false,
    car: false,
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
  const propsRef = useRef<THREE.Group[]>([]);
  const animationFrameRef = useRef<number>();
  const timeRef = useRef<number>(0);

  // Add refs for human movement
  const targetPositionRef = useRef(new THREE.Vector3(0, 0, 0));
  const movementTimeoutRef = useRef<number>();

  useEffect(() => {
    if (!containerRef.current) return;

    console.log('Initializing Studio Workspace with dimensions:', dimensions);
    console.log('Human position:', humanPosition);
    console.log('PTZ tracks:', ptzTracks);
    console.log('Props configuration:', props);

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

    // Create human figure - ensure it starts at floor level
    humanRef.current = createHumanFigure({ 
      position: { ...humanPosition, y: 0 }, // Force y to 0
      scene,
      dimensions 
    });
    console.log('Human figure created at position:', humanRef.current?.position);

    // Create PTZ camera
    if (ptzTracks && ptzTracks.length > 0) {
      ptzCameraRef.current = createPTZCamera({ 
        track: ptzTracks[0], 
        showCone: cameras.showCone,
        scene,
        dimensions
      });
      console.log('PTZ camera created at position:', ptzCameraRef.current?.position);
    }

    // Create fixed cameras
    fixedCamerasRef.current = createFixedCameras({ dimensions, cameras, scene });
    console.log('Fixed cameras created:', fixedCamerasRef.current.length);

    // Create props
    propsRef.current = createProps({ props, dimensions, scene });
    console.log('Props created:', propsRef.current.length);

    // Function to generate new random target position within room bounds
    const generateNewTarget = () => {
      const halfWidth = dimensions.width / 2;
      const halfLength = dimensions.length / 2;
      
      targetPositionRef.current.set(
        Math.random() * dimensions.width - halfWidth,
        0, // Always on floor
        Math.random() * dimensions.length - halfLength
      );

      // Schedule next target update
      movementTimeoutRef.current = window.setTimeout(generateNewTarget, Math.random() * 5000 + 3000);
    };

    // Initial target position
    generateNewTarget();

    // Animation loop
    const animate = () => {
      timeRef.current += 0.005;
      
      if (humanRef.current) {
        // Move human figure towards target position
        const currentPos = humanRef.current.position;
        const targetPos = targetPositionRef.current;
        
        // Calculate movement step (lerp)
        currentPos.x += (targetPos.x - currentPos.x) * 0.02;
        currentPos.z += (targetPos.z - currentPos.z) * 0.02;
        currentPos.y = 0; // Always on floor

        // Constrain within room bounds
        currentPos.x = Math.max(-dimensions.width/2 + 1, Math.min(dimensions.width/2 - 1, currentPos.x));
        currentPos.z = Math.max(-dimensions.length/2 + 1, Math.min(dimensions.length/2 - 1, currentPos.z));

        console.log('Human position during animation:', {
          x: currentPos.x,
          y: currentPos.y,
          z: currentPos.z
        });
      }

      if (ptzCameraRef.current && humanRef.current && ptzTracks[0]) {
        // Make PTZ camera look at human
        ptzCameraRef.current.lookAt(humanRef.current.position);
        
        const track = ptzTracks[0];
        // Smooth oscillation along track
        const trackPosition = Math.sin(timeRef.current * track.speed) * (track.length / 2);
        ptzCameraRef.current.position.x = track.position.x + trackPosition;
        
        console.log('PTZ camera position during animation:', ptzCameraRef.current.position);
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
      if (movementTimeoutRef.current) {
        clearTimeout(movementTimeoutRef.current);
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
