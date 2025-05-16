import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBasicStudioLighting, createProductLighting } from './utils/studioLighting';
import type { WorkspaceDimensions, PTZTrack } from './types/workspace';
import { SpatialLMAnalysis } from './visualization/SpatialLMAnalysis';
import { useSpatialLM } from '@/hooks/useSpatialLM';

interface StudioWorkspaceProps {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
  selectedCameraIndex?: number | null;
  onCameraSelect?: (index: number) => void;
}

export const StudioWorkspace: React.FC<StudioWorkspaceProps> = ({
  dimensions,
  ptzTracks,
  selectedCameraIndex = null,
  onCameraSelect = () => {}
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraModelsRef = useRef<THREE.Group[]>([]);
  const trackModelsRef = useRef<THREE.Line[]>([]);
  const coneModelsRef = useRef<THREE.Mesh[]>([]);

  // Initialize SpatialLM integration
  const {
    isInitialized,
    isAnalyzing,
    isOptimizing,
    error,
    analyzeWorkspace,
    optimizePositions
  } = useSpatialLM({
    dimensions,
    ptzTracks,
    onOptimizedPositions: (positions) => {
      // Handle optimized positions
      console.log('Optimized positions:', positions);
    },
    onAnalysisUpdate: (analysis) => {
      // Handle analysis updates
      console.log('Analysis update:', analysis);
    }
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff); // White background
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 5, 15);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
    }
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    if (!scene.userData) {
      scene.userData = {};
    }
    scene.userData.renderer = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    // Create wireframe studio room
    createWireframeRoom(scene, dimensions);
    
    // Create CNC tracks along the walls and ceiling
    createCNCTracks(scene, dimensions);
    
    // Add a reference object in the center
    const humanFigure = createHumanFigure();
    scene.add(humanFigure);

    // Create camera models for each PTZ track with cones for FOV
    createCameraModels(scene, ptzTracks);

    // Set up click handling for camera selection
    const handleMouseClick = (event: MouseEvent) => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current || !sceneRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / containerRef.current.clientWidth) * 2 - 1;
      const y = -((event.clientY - rect.top) / containerRef.current.clientHeight) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);

      const intersects = raycaster.intersectObjects(sceneRef.current.children, true);
      for (const intersect of intersects) {
        if (intersect.object.userData.type === 'camera') {
          onCameraSelect(intersect.object.userData.index);
          break;
        }
      }
    };

    containerRef.current.addEventListener('click', handleMouseClick);

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

    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };
    
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      containerRef.current?.removeEventListener('click', handleMouseClick);
      
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

  // Function to create a wireframe room
  const createWireframeRoom = (scene: THREE.Scene, dimensions: WorkspaceDimensions) => {
    const { length, width, height } = dimensions;
    
    // Create wireframe material
    const wireMaterial = new THREE.LineBasicMaterial({ 
      color: 0x444444,
      linewidth: 1
    });
    
    // Floor outline
    const floorGeometry = new THREE.BufferGeometry();
    const floorVertices = new Float32Array([
      -length/2, 0, -width/2,
      length/2, 0, -width/2,
      length/2, 0, width/2,
      -length/2, 0, width/2,
      -length/2, 0, -width/2
    ]);
    floorGeometry.setAttribute('position', new THREE.BufferAttribute(floorVertices, 3));
    const floor = new THREE.Line(floorGeometry, wireMaterial);
    scene.add(floor);
    
    // Ceiling outline
    const ceilingGeometry = new THREE.BufferGeometry();
    const ceilingVertices = new Float32Array([
      -length/2, height, -width/2,
      length/2, height, -width/2,
      length/2, height, width/2,
      -length/2, height, width/2,
      -length/2, height, -width/2
    ]);
    ceilingGeometry.setAttribute('position', new THREE.BufferAttribute(ceilingVertices, 3));
    const ceiling = new THREE.Line(ceilingGeometry, wireMaterial);
    scene.add(ceiling);
    
    // Vertical edges
    const pillar1 = new THREE.BufferGeometry();
    pillar1.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -length/2, 0, -width/2, -length/2, height, -width/2
    ]), 3));
    scene.add(new THREE.Line(pillar1, wireMaterial));
    
    const pillar2 = new THREE.BufferGeometry();
    pillar2.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      length/2, 0, -width/2, length/2, height, -width/2
    ]), 3));
    scene.add(new THREE.Line(pillar2, wireMaterial));
    
    const pillar3 = new THREE.BufferGeometry();
    pillar3.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      length/2, 0, width/2, length/2, height, width/2
    ]), 3));
    scene.add(new THREE.Line(pillar3, wireMaterial));
    
    const pillar4 = new THREE.BufferGeometry();
    pillar4.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -length/2, 0, width/2, -length/2, height, width/2
    ]), 3));
    scene.add(new THREE.Line(pillar4, wireMaterial));
    
    // Floor grid
    const gridHelper = new THREE.GridHelper(Math.max(length, width), Math.max(length, width)/2, 0x888888, 0xdddddd);
    gridHelper.position.y = 0.01; // Slightly above floor to avoid z-fighting
    scene.add(gridHelper);
  };
  
  // Function to create CNC tracks along walls and ceiling
  const createCNCTracks = (scene: THREE.Scene, dimensions: WorkspaceDimensions) => {
    const { length, width, height } = dimensions;
    
    // Track material
    const trackMaterial = new THREE.LineBasicMaterial({ color: 0x0088ff, linewidth: 2 });
    
    // Create tracks
    // 1. Front wall track (X-axis)
    const frontTrackGeometry = new THREE.BufferGeometry();
    frontTrackGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -length/2, height * 0.75, width/2,
      length/2, height * 0.75, width/2
    ]), 3));
    const frontTrack = new THREE.Line(frontTrackGeometry, trackMaterial);
    scene.add(frontTrack);
    
    // 2. Back wall track (X-axis)
    const backTrackGeometry = new THREE.BufferGeometry();
    backTrackGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -length/2, height * 0.75, -width/2,
      length/2, height * 0.75, -width/2
    ]), 3));
    const backTrack = new THREE.Line(backTrackGeometry, trackMaterial);
    scene.add(backTrack);
    
    // 3. Left wall track (Z-axis)
    const leftTrackGeometry = new THREE.BufferGeometry();
    leftTrackGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -length/2, height * 0.75, -width/2,
      -length/2, height * 0.75, width/2
    ]), 3));
    const leftTrack = new THREE.Line(leftTrackGeometry, trackMaterial);
    scene.add(leftTrack);
    
    // 4. Right wall track (Z-axis)
    const rightTrackGeometry = new THREE.BufferGeometry();
    rightTrackGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      length/2, height * 0.75, -width/2,
      length/2, height * 0.75, width/2
    ]), 3));
    const rightTrack = new THREE.Line(rightTrackGeometry, trackMaterial);
    scene.add(rightTrack);
    
    // 5. Ceiling track (center, X-axis)
    const ceilingXTrackGeometry = new THREE.BufferGeometry();
    ceilingXTrackGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -length/2, height, 0,
      length/2, height, 0
    ]), 3));
    const ceilingXTrack = new THREE.Line(ceilingXTrackGeometry, trackMaterial);
    scene.add(ceilingXTrack);
    
    // 6. Ceiling track (center, Z-axis)
    const ceilingZTrackGeometry = new THREE.BufferGeometry();
    ceilingZTrackGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, height, -width/2,
      0, height, width/2
    ]), 3));
    const ceilingZTrack = new THREE.Line(ceilingZTrackGeometry, trackMaterial);
    scene.add(ceilingZTrack);
    
    // Store all tracks in the ref for later access
    trackModelsRef.current = [
      frontTrack, backTrack, leftTrack, rightTrack, ceilingXTrack, ceilingZTrack
    ];
  };
  
  // Function to create a simple human figure for scale reference
  const createHumanFigure = () => {
    const group = new THREE.Group();
    
    // Body
    const bodyGeometry = new THREE.CylinderGeometry(0.2, 0.2, 1.2, 8);
    const bodyMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x888888,
      wireframe: true,
      wireframeLinewidth: 2
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.8;
    group.add(body);
    
    // Head
    const headGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    const head = new THREE.Mesh(headGeometry, bodyMaterial);
    head.position.y = 1.6;
    group.add(head);
    
    // Legs
    const legGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.8, 8);
    
    const leftLeg = new THREE.Mesh(legGeometry, bodyMaterial);
    leftLeg.position.set(-0.1, 0.2, 0);
    group.add(leftLeg);
    
    const rightLeg = new THREE.Mesh(legGeometry, bodyMaterial);
    rightLeg.position.set(0.1, 0.2, 0);
    group.add(rightLeg);
    
    // Arms
    const armGeometry = new THREE.CylinderGeometry(0.07, 0.07, 0.8, 8);
    
    const leftArm = new THREE.Mesh(armGeometry, bodyMaterial);
    leftArm.rotation.z = Math.PI / 4;
    leftArm.position.set(-0.4, 1.0, 0);
    group.add(leftArm);
    
    const rightArm = new THREE.Mesh(armGeometry, bodyMaterial);
    rightArm.rotation.z = -Math.PI / 4;
    rightArm.position.set(0.4, 1.0, 0);
    group.add(rightArm);
    
    return group;
  };
  
  // Function to create camera models with FOV cones
  const createCameraModels = (scene: THREE.Scene, ptzTracks: PTZTrack[]) => {
    // Clear existing camera models ref
    cameraModelsRef.current = [];
    coneModelsRef.current = [];
    
    ptzTracks.forEach((track, index) => {
      const cameraGroup = new THREE.Group();
      
      // Camera body
      const cameraBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.4, 0.6),
        new THREE.MeshBasicMaterial({ color: selectedCameraIndex === index ? 0xff6600 : 0x333333, wireframe: true })
      );
      cameraGroup.add(cameraBody);
      
      // Camera lens
      const cameraLens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.3, 16),
        new THREE.MeshBasicMaterial({ color: 0x111111, wireframe: true })
      );
      cameraLens.rotation.x = Math.PI / 2;
      cameraLens.position.z = 0.45;
      cameraGroup.add(cameraLens);
      
      // Create the field of view cone
      const coneLength = track.length || 10; // Default length
      const coneAngle = track.coneAngle || 45; // Default angle in degrees
      
      const fovConeMaterial = new THREE.MeshBasicMaterial({ 
        color: selectedCameraIndex === index ? 0xff9900 : 0x0088ff, 
        transparent: true, 
        opacity: 0.2,
        wireframe: true
      });
      
      // Convert degrees to radians
      const coneRadians = THREE.MathUtils.degToRad(coneAngle);
      
      // Calculate cone radius based on angle and length
      const coneRadius = Math.tan(coneRadians / 2) * coneLength;
      
      const fovConeGeometry = new THREE.ConeGeometry(coneRadius, coneLength, 32);
      const fovCone = new THREE.Mesh(fovConeGeometry, fovConeMaterial);
      
      // Rotate cone to point forward
      fovCone.rotation.x = Math.PI / 2;
      fovCone.position.z = coneLength / 2 + 0.3; // Position in front of camera
      
      cameraGroup.add(fovCone);
      coneModelsRef.current.push(fovCone);
      
      // Set position
      cameraGroup.position.set(
        track.position.x,
        track.position.y,
        track.position.z
      );
      
      // Look at target point
      if (track.target) {
        const targetVector = new THREE.Vector3(track.target.x, track.target.y, track.target.z);
        cameraGroup.lookAt(targetVector);
      }
      
      // Store the track index in userData for raycasting
      cameraGroup.userData = { 
        type: 'camera',
        index: index
      };
      
      scene.add(cameraGroup);
      cameraModelsRef.current.push(cameraGroup);
    });
  };

  // Update camera positions when ptzTracks change
  useEffect(() => {
    if (!sceneRef.current) return;
    
    // Update existing camera models
    ptzTracks.forEach((track, index) => {
      if (index < cameraModelsRef.current.length) {
        const cameraGroup = cameraModelsRef.current[index];
        cameraGroup.position.set(track.position.x, track.position.y, track.position.z);
        
        // Update the FOV cone
        if (index < coneModelsRef.current.length) {
          const cone = coneModelsRef.current[index];
          
          // Update cone size if needed
          const coneLength = track.length || 10;
          const coneAngle = track.coneAngle || 45;
          const coneRadians = THREE.MathUtils.degToRad(coneAngle);
          const coneRadius = Math.tan(coneRadians / 2) * coneLength;
          
          // Remove old cone and create a new one with updated dimensions
          if (cone.geometry) {
            cone.geometry.dispose();
          }
          cone.geometry = new THREE.ConeGeometry(coneRadius, coneLength, 32);
          cone.position.z = coneLength / 2 + 0.3;
          
          // Update material color based on selection
          if (cone.material) {
            (cone.material as THREE.MeshBasicMaterial).color.set(
              selectedCameraIndex === index ? 0xff9900 : 0x0088ff
            );
          }
        }
        
        if (track.target) {
          const targetVector = new THREE.Vector3(track.target.x, track.target.y, track.target.z);
          cameraGroup.lookAt(targetVector);
        }
        
        // Update camera body color based on selection
        const cameraBody = cameraGroup.children[0] as THREE.Mesh;
        if (cameraBody && cameraBody.material) {
          (cameraBody.material as THREE.MeshBasicMaterial).color.set(
            selectedCameraIndex === index ? 0xff6600 : 0x333333
          );
        }
      }
    });
  }, [ptzTracks, selectedCameraIndex]);

  // Trigger workspace analysis when dimensions or tracks change
  useEffect(() => {
    if (isInitialized && !isAnalyzing) {
      analyzeWorkspace();
    }
  }, [dimensions, ptzTracks, isInitialized, isAnalyzing]);

  return (
    <div ref={containerRef} className="w-full h-full">
      {sceneRef.current && (
        <SpatialLMAnalysis
          dimensions={dimensions}
          coverageScore={0.85} // This will be updated by the analysis
          blindSpots={[]} // This will be updated by the analysis
          scene={sceneRef.current}
        />
      )}
    </div>
  );
};
