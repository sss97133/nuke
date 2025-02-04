import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { StudioConfigV2 } from './StudioConfigurationV2';
import { createHumanFigure } from './workspace/HumanFigure';
import { createProps } from './workspace/Props';

interface StudioWorkspaceV2Props {
  config: StudioConfigV2;
}

export const StudioWorkspaceV2 = ({ config }: StudioWorkspaceV2Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const timeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>();

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
    camera.position.set(
      config.dimensions.length * 1.5,
      config.dimensions.height * 1.5,
      config.dimensions.width * 1.5
    );
    cameraRef.current = camera;

    // Initialize renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Add OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    // Add lighting
    const ambientLight = new THREE.AmbientLight(0x404040);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1);
    scene.add(directionalLight);

    // Create room geometry
    const roomGeometry = new THREE.BoxGeometry(
      config.dimensions.width,
      config.dimensions.height,
      config.dimensions.length
    );
    const edges = new THREE.EdgesGeometry(roomGeometry);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x000000 })
    );
    scene.add(line);

    // Create PTZ tracks with dynamic movement
    config.ptzTracks.forEach(track => {
      const trackGroup = new THREE.Group();
      
      // Track base
      const trackGeometry = new THREE.BoxGeometry(track.length, 0.2, 0.2);
      const trackMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
      const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
      trackGroup.add(trackMesh);

      // Camera
      const cameraGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.8);
      const cameraMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
      const cameraMesh = new THREE.Mesh(cameraGeometry, cameraMaterial);
      trackGroup.add(cameraMesh);

      // Cone for field of view
      if (config.cameras.showCone) {
        const coneHeight = Math.min(config.dimensions.length, config.dimensions.width) / 4;
        const coneGeometry = new THREE.ConeGeometry(
          Math.tan((track.coneAngle * Math.PI) / 180) * coneHeight,
          coneHeight,
          32
        );
        const coneMaterial = new THREE.MeshPhongMaterial({
          color: 0xffff00,
          transparent: true,
          opacity: 0.3
        });
        const cone = new THREE.Mesh(coneGeometry, coneMaterial);
        cone.rotation.x = -Math.PI / 2;
        trackGroup.add(cone);
      }

      // Initial position
      trackGroup.position.set(
        track.position.x,
        track.position.y,
        track.position.z
      );
      scene.add(trackGroup);
    });

    // Create human figure
    createHumanFigure({
      position: config.humanPosition,
      scene,
      dimensions: config.dimensions
    });

    // Create props
    createProps({
      props: config.props,
      dimensions: config.dimensions,
      scene
    });

    // Animation loop
    const animate = () => {
      timeRef.current += 0.016; // Approximately 60fps

      // Update PTZ track positions
      config.ptzTracks.forEach((track, index) => {
        const trackObject = scene.children.find(
          child => child instanceof THREE.Group && child.userData.trackIndex === index
        );
        if (trackObject) {
          // Calculate dynamic position based on movement parameters
          const newX = track.position.x + 
            Math.sin(timeRef.current * track.movement.frequency + track.movement.phase) * 
            track.movement.amplitude.x;
          
          const newZ = track.position.z + 
            Math.cos(timeRef.current * track.movement.frequency + track.movement.phase) * 
            track.movement.amplitude.z;

          trackObject.position.set(newX, track.position.y, newZ);
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
  }, [config]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-[400px] border border-border rounded-lg shadow-classic"
    />
  );
};