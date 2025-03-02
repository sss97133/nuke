
import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { createLighting } from './utils/studioLighting';
import { createPTZCamera } from './components/PTZCamera';
import { createHumanFigure } from './components/HumanFigure';
import type { StudioWorkspaceProps } from './types/componentTypes';

export const StudioWorkspace: React.FC<StudioWorkspaceProps> = ({
  dimensions,
  ptzTracks,
  onCameraSelect,
  selectedCameraIndex
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const ptzCamerasRef = useRef<{ trackMesh: THREE.Mesh, ptzGroup: THREE.Group }[]>([]);
  const humanFigureRef = useRef<THREE.Group | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize scene
  useEffect(() => {
    if (!containerRef.current || isInitialized) return;

    // Create scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    sceneRef.current = scene;

    // Create camera
    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, dimensions.height / 2, dimensions.length);
    camera.lookAt(0, dimensions.height / 2, 0);
    cameraRef.current = camera;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Set scene to userdata for easier reference
    scene.userData.renderer = renderer;

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      
      cameraRef.current.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };

    window.addEventListener('resize', handleResize);
    
    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    setIsInitialized(true);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
    };
  }, [dimensions.height, dimensions.length, isInitialized]);

  // Create or update studio elements
  useEffect(() => {
    if (!sceneRef.current) return;
    
    const scene = sceneRef.current;
    
    // Clear previous objects
    scene.children = scene.children.filter(child => 
      child.type === 'Camera' || 
      child.type === 'AmbientLight' || 
      child.type === 'DirectionalLight'
    );
    
    // Create floor
    const floorGeometry = new THREE.PlaneGeometry(dimensions.width, dimensions.length);
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);
    
    // Create walls
    const wallMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x555555,
      roughness: 0.7,
      metalness: 0.1
    });
    
    // Back wall
    const backWallGeometry = new THREE.PlaneGeometry(dimensions.width, dimensions.height);
    const backWall = new THREE.Mesh(backWallGeometry, wallMaterial);
    backWall.position.set(0, dimensions.height/2, -dimensions.length/2);
    backWall.receiveShadow = true;
    scene.add(backWall);
    
    // Left wall
    const leftWallGeometry = new THREE.PlaneGeometry(dimensions.length, dimensions.height);
    const leftWall = new THREE.Mesh(leftWallGeometry, wallMaterial);
    leftWall.position.set(-dimensions.width/2, dimensions.height/2, 0);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.receiveShadow = true;
    scene.add(leftWall);
    
    // Right wall
    const rightWallGeometry = new THREE.PlaneGeometry(dimensions.length, dimensions.height);
    const rightWall = new THREE.Mesh(rightWallGeometry, wallMaterial);
    rightWall.position.set(dimensions.width/2, dimensions.height/2, 0);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.receiveShadow = true;
    scene.add(rightWall);
    
    // Add lighting
    createLighting(scene, dimensions);
    
    // Add human figure
    if (humanFigureRef.current) {
      scene.remove(humanFigureRef.current);
    }
    humanFigureRef.current = createHumanFigure();
    humanFigureRef.current.position.set(0, 0, 0);
    scene.add(humanFigureRef.current);
    
    // Clear old PTZ cameras
    if (ptzCamerasRef.current.length > 0) {
      ptzCamerasRef.current.forEach(({ trackMesh, ptzGroup }) => {
        scene.remove(trackMesh);
        scene.remove(ptzGroup);
      });
    }
    
    // Add PTZ cameras
    ptzCamerasRef.current = ptzTracks.map((track, index) => {
      // Calculate the longest dimension for camera cone
      const maxDimension = Math.max(dimensions.length, dimensions.width, dimensions.height);
      
      // Create PTZ camera
      const ptzCamera = createPTZCamera(
        scene, 
        track, 
        maxDimension, 
        selectedCameraIndex === index
      );
      
      // Add user data for raycasting
      ptzCamera.ptzGroup.userData = { 
        type: 'ptzCamera',
        index: index
      };
      
      return ptzCamera;
    });
    
  }, [dimensions, ptzTracks, selectedCameraIndex]);

  // Handle camera selection via raycasting
  useEffect(() => {
    if (!containerRef.current || !sceneRef.current || !cameraRef.current) return;
    
    const handleMouseDown = (event: MouseEvent) => {
      if (!containerRef.current || !sceneRef.current || !cameraRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / containerRef.current.clientWidth) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / containerRef.current.clientHeight) * 2 + 1;
      
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      
      // Find all objects intersecting with the ray
      const intersects = raycasterRef.current.intersectObjects(
        sceneRef.current.children, 
        true
      );
      
      // Find the first camera that was clicked
      for (let i = 0; i < intersects.length; i++) {
        // Walk up the parent chain to find the root object with userData
        let currentObject = intersects[i].object;
        while (currentObject && !currentObject.userData?.type) {
          currentObject = currentObject.parent as THREE.Object3D;
        }
        
        if (currentObject && currentObject.userData?.type === 'ptzCamera') {
          if (onCameraSelect) {
            onCameraSelect(currentObject.userData.index);
          }
          break;
        }
      }
    };
    
    containerRef.current.addEventListener('mousedown', handleMouseDown);
    
    return () => {
      if (containerRef.current) {
        containerRef.current.removeEventListener('mousedown', handleMouseDown);
      }
    };
  }, [onCameraSelect]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-[500px] border rounded-md overflow-hidden"
      style={{ position: 'relative' }}
    >
      {/* Studio workspace will render here */}
      {selectedCameraIndex !== null && selectedCameraIndex !== undefined && (
        <div className="absolute top-4 right-4 bg-black/50 px-3 py-1 rounded text-white text-sm">
          Camera {selectedCameraIndex + 1} Selected
        </div>
      )}
    </div>
  );
};
