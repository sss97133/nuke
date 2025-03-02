
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PTZTrack } from '@/components/studio/types/workspace';

/**
 * Sets up the basic Three.js scene, camera, renderer, and controls
 */
export const setupThreeJsScene = (
  containerRef: React.RefObject<HTMLDivElement>
) => {
  if (!containerRef.current) return null;

  // Create scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f5); // Light gray background

  // Create camera
  const camera = new THREE.PerspectiveCamera(
    75,
    containerRef.current.clientWidth / containerRef.current.clientHeight,
    0.1,
    1000
  );
  camera.position.set(0, 5, 15);

  // Create renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
  renderer.shadowMap.enabled = true;
  containerRef.current.appendChild(renderer.domElement);

  // Create orbit controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 3;
  controls.maxDistance = 30;

  return { scene, camera, renderer, controls };
};

/**
 * Setup event handlers for raycasting, window resize, etc.
 */
export const setupEventHandlers = (
  containerRef: React.RefObject<HTMLDivElement>,
  camera: THREE.PerspectiveCamera,
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  onCameraSelect: (index: number) => void
) => {
  if (!containerRef.current) return {};
  
  // Raycaster setup
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  
  // Click handler for selecting cameras
  const handleMouseClick = (event: MouseEvent) => {
    if (!containerRef.current || !camera || !scene) return;
    
    // Calculate mouse position in normalized device coordinates
    const rect = containerRef.current.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / containerRef.current.clientWidth) * 2 - 1;
    mouse.y = - ((event.clientY - rect.top) / containerRef.current.clientHeight) * 2 + 1;
    
    // Update the picking ray with the camera and mouse position
    raycaster.setFromCamera(mouse, camera);
    
    // Calculate objects intersecting the ray
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    // Check if we intersected with a camera
    for (let i = 0; i < intersects.length; i++) {
      const obj = intersects[i].object;
      // Traverse up to find the group that has userData
      let current = obj;
      while (current && current.parent) {
        if (current.userData && current.userData.type === 'camera') {
          onCameraSelect(current.userData.index);
          return;
        }
        current = current.parent;
      }
    }
  };
  
  // Window resize handler
  const handleResize = () => {
    if (!containerRef.current || !camera || !renderer) return;
    
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  
  // Add event listeners
  containerRef.current.addEventListener('click', handleMouseClick);
  window.addEventListener('resize', handleResize);
  
  // Return cleanup function
  return {
    cleanup: () => {
      window.removeEventListener('resize', handleResize);
      containerRef.current?.removeEventListener('click', handleMouseClick);
    }
  };
};

/**
 * Setup field of view controls for zooming in and out
 */
export const setupFieldOfViewControls = (
  camera: THREE.PerspectiveCamera,
  ptzTracks: PTZTrack[],
  selectedCameraIndex: number | null
) => {
  // Zoom in function
  const zoomIn = () => {
    // Adjust main camera FOV
    camera.fov = Math.max(45, camera.fov - 5); 
    camera.updateProjectionMatrix();
  };

  // Zoom out function
  const zoomOut = () => {
    // Adjust main camera FOV
    camera.fov = Math.min(95, camera.fov + 5);
    camera.updateProjectionMatrix();
  };

  return { zoomIn, zoomOut };
};
