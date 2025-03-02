
import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBasicStudioLighting } from './utils/studioLighting';
import { createPTZCamera } from './components/PTZCamera';
import { useStudioAnimation } from './hooks/useStudioAnimation';
import { HumanFigure } from './components/HumanFigure';
import type { WorkspaceDimensions, PTZTrack } from '@/types/studio';
import type { StudioWorkspaceProps } from './types/componentTypes';

export const StudioWorkspace: React.FC<StudioWorkspaceProps> = ({
  dimensions,
  ptzTracks,
  onSelectCamera,
  selectedCameraIndex
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const humanRef = useRef<THREE.Group | null>(null);
  const ptzCamerasRef = useRef<THREE.Group[]>([]);
  const trackMeshesRef = useRef<THREE.Mesh[]>([]);
  const [isAnimating, setIsAnimating] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);
    sceneRef.current = scene;

    // Initialize Camera
    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(dimensions.width / 2, dimensions.height * 0.7, dimensions.length * 0.7);
    cameraRef.current = camera;

    // Initialize Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    scene.userData.renderer = renderer;

    // Initialize Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, dimensions.height / 4, 0);
    controlsRef.current = controls;

    // Create Studio Floor
    const floorGeometry = new THREE.PlaneGeometry(dimensions.width, dimensions.length);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.8
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Create Studio Walls
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
    
    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(dimensions.width, dimensions.height),
      wallMaterial
    );
    backWall.position.z = -dimensions.length / 2;
    backWall.position.y = dimensions.height / 2;
    backWall.receiveShadow = true;
    scene.add(backWall);
    
    const leftWall = new THREE.Mesh(
      new THREE.PlaneGeometry(dimensions.length, dimensions.height),
      wallMaterial
    );
    leftWall.position.x = -dimensions.width / 2;
    leftWall.position.y = dimensions.height / 2;
    leftWall.rotation.y = Math.PI / 2;
    leftWall.receiveShadow = true;
    scene.add(leftWall);
    
    const rightWall = new THREE.Mesh(
      new THREE.PlaneGeometry(dimensions.length, dimensions.height),
      wallMaterial
    );
    rightWall.position.x = dimensions.width / 2;
    rightWall.position.y = dimensions.height / 2;
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.receiveShadow = true;
    scene.add(rightWall);

    // Create Human Figure
    const human = new HumanFigure();
    human.position.y = 0;
    scene.add(human);
    humanRef.current = human;

    // Clear previous PTZ cameras if any
    ptzCamerasRef.current = [];
    trackMeshesRef.current = [];

    // Create PTZ Cameras
    ptzTracks.forEach((track, index) => {
      const isActive = selectedCameraIndex === index;
      const { trackMesh, ptzGroup } = createPTZCamera(scene, track, Math.max(dimensions.width, dimensions.length), isActive);
      
      // Store references for animation
      ptzCamerasRef.current.push(ptzGroup);
      trackMeshesRef.current.push(trackMesh);
      
      // Add click handler for camera selection
      if (onSelectCamera) {
        const clickableParts = ptzGroup.children.filter(child => child instanceof THREE.Mesh);
        clickableParts.forEach(part => {
          if (part instanceof THREE.Mesh) {
            part.userData.clickable = true;
            part.userData.cameraIndex = index;
          }
        });
      }
    });

    // Add Studio Lighting
    createBasicStudioLighting(scene);

    // Handle click events for camera selection
    if (onSelectCamera) {
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();

      const handleMouseClick = (event: MouseEvent) => {
        // Calculate mouse position in normalized device coordinates
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Update the picking ray with the camera and mouse position
        raycaster.setFromCamera(mouse, camera);

        // Calculate objects intersecting the picking ray
        const intersects = raycaster.intersectObjects(scene.children, true);
        
        for (let i = 0; i < intersects.length; i++) {
          const object = intersects[i].object;
          if (object.userData?.clickable && object.userData?.cameraIndex !== undefined) {
            onSelectCamera(object.userData.cameraIndex);
            break;
          }
        }
      };

      renderer.domElement.addEventListener('click', handleMouseClick);
    }

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };
    
    window.addEventListener('resize', handleResize);

    // Animation
    const { resetAnimation } = useStudioAnimation(
      humanRef,
      ptzCamerasRef,
      ptzTracks,
      dimensions,
      isAnimating
    );

    return () => {
      window.removeEventListener('resize', handleResize);
      
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
  }, [dimensions, ptzTracks, onSelectCamera, selectedCameraIndex]);

  // Update selected camera visuals when selection changes
  useEffect(() => {
    if (!sceneRef.current) return;
    
    ptzTracks.forEach((track, index) => {
      // Remove existing cameras
      sceneRef.current?.children.forEach(child => {
        if (child.userData?.cameraIndex === index) {
          sceneRef.current?.remove(child);
        }
      });
      
      // Create new camera with updated active state
      const isActive = selectedCameraIndex === index;
      const { trackMesh, ptzGroup } = createPTZCamera(sceneRef.current, track, Math.max(dimensions.width, dimensions.length), isActive);
      
      // Store references
      ptzCamerasRef.current[index] = ptzGroup;
      trackMeshesRef.current[index] = trackMesh;
      
      // Add click handler
      if (onSelectCamera) {
        ptzGroup.children.forEach(part => {
          if (part instanceof THREE.Mesh) {
            part.userData.clickable = true;
            part.userData.cameraIndex = index;
          }
        });
      }
    });
  }, [selectedCameraIndex]);

  // Toggle animation
  const toggleAnimation = () => {
    setIsAnimating(!isAnimating);
  };

  return (
    <div ref={containerRef} className="w-full h-full relative bg-black">
      {/* Optional UI overlays can be added here */}
      <button 
        className="absolute bottom-4 right-4 bg-black/50 text-white px-3 py-1 rounded-md text-sm"
        onClick={toggleAnimation}
      >
        {isAnimating ? 'Pause Animation' : 'Resume Animation'}
      </button>
    </div>
  );
};
