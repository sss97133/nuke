import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface StudioWorkspaceProps {
  dimensions: {
    length: number;
    width: number;
    height: number;
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

export const StudioWorkspace = ({ dimensions, ptzTracks = [] }: StudioWorkspaceProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const objectsRef = useRef<THREE.Object3D[]>([]);
  const humanRef = useRef<THREE.Group | null>(null);
  const ptzCameraRef = useRef<THREE.Group | null>(null);
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

    // Create human figure (6 feet tall = 1.83 meters)
    const createHuman = () => {
      const human = new THREE.Group();
      const humanHeight = 6;
      
      // Body (1/3 of total height)
      const bodyGeometry = new THREE.CylinderGeometry(0.4, 0.4, humanHeight/3, 8);
      const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x0000ff });
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      body.position.y = humanHeight/3/2;
      human.add(body);

      // Head (1/6 of total height)
      const headGeometry = new THREE.SphereGeometry(0.4, 8, 8);
      const headMaterial = new THREE.MeshPhongMaterial({ color: 0xffcc99 });
      const head = new THREE.Mesh(headGeometry, headMaterial);
      head.position.y = humanHeight/3 + 0.4;
      human.add(head);

      // Legs (1/2 of total height)
      const legGeometry = new THREE.CylinderGeometry(0.2, 0.2, humanHeight/2, 8);
      const legMaterial = new THREE.MeshPhongMaterial({ color: 0x0000ff });
      
      const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
      leftLeg.position.set(0.3, humanHeight/4, 0);
      human.add(leftLeg);
      
      const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
      rightLeg.position.set(-0.3, humanHeight/4, 0);
      human.add(rightLeg);

      // Position at ground level
      human.position.y = 0;
      scene.add(human);
      humanRef.current = human;
    };

    createHuman();

    // Animation loop
    const animate = () => {
      timeRef.current += 0.005; // Slower movement
      
      if (humanRef.current) {
        // Random walk pattern
        const walkRadius = Math.min(dimensions.length, dimensions.width) / 2 - 2;
        humanRef.current.position.x = Math.sin(timeRef.current) * walkRadius;
        humanRef.current.position.z = Math.cos(timeRef.current * 0.7) * walkRadius;
        
        // Add slight bobbing motion for walking while maintaining ground contact
        humanRef.current.position.y = Math.sin(timeRef.current * 4) * 0.1;
      }

      if (ptzCameraRef.current && humanRef.current) {
        // Make PTZ camera track human
        ptzCameraRef.current.lookAt(humanRef.current.position);
        
        // Move PTZ camera along track
        if (ptzTracks[0]) {
          const track = ptzTracks[0];
          const trackPosition = Math.sin(timeRef.current * track.speed) * (track.length / 2);
          ptzCameraRef.current.position.x = track.position.x + trackPosition;
        }
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
  }, []); // Only run once on mount

  // Update scene when dimensions or PTZ tracks change
  useEffect(() => {
    if (!sceneRef.current) return;

    // Remove old objects
    objectsRef.current.forEach(obj => sceneRef.current?.remove(obj));
    objectsRef.current = [];

    // Add room geometry
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
    sceneRef.current.add(line);
    objectsRef.current.push(line);

    // Add grid helper
    const gridHelper = new THREE.GridHelper(Math.max(dimensions.width, dimensions.length), 10);
    gridHelper.position.y = -dimensions.height / 2;
    sceneRef.current.add(gridHelper);
    objectsRef.current.push(gridHelper);

    // Add PTZ tracks and cameras
    ptzTracks.forEach(track => {
      // Track
      const trackGeometry = new THREE.BoxGeometry(track.length, 0.2, 0.2);
      const trackMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
      const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
      trackMesh.position.set(track.position.x, track.position.y, track.position.z);
      sceneRef.current?.add(trackMesh);
      objectsRef.current.push(trackMesh);

      // PTZ Camera group
      const ptzGroup = new THREE.Group();
      
      // Camera body
      const cameraGeometry = new THREE.SphereGeometry(0.3, 8, 8);
      const cameraMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
      const cameraMesh = new THREE.Mesh(cameraGeometry, cameraMaterial);
      ptzGroup.add(cameraMesh);

      // Camera cone (field of view)
      const maxDistance = Math.max(dimensions.length, dimensions.width) * 2; // Extend beyond room
      const coneHeight = maxDistance;
      const coneRadius = Math.tan((track.coneAngle * Math.PI) / 180) * coneHeight;
      const coneGeometry = new THREE.ConeGeometry(coneRadius, coneHeight, 32);
      const coneMaterial = new THREE.MeshPhongMaterial({ 
        color: 0xff0000,
        transparent: true,
        opacity: 0.2
      });
      const cone = new THREE.Mesh(coneGeometry, coneMaterial);
      // Position cone with vertex at camera center, pointing forward
      cone.rotation.x = Math.PI / 2;
      cone.position.z = coneHeight / 2;
      ptzGroup.add(cone);

      ptzGroup.position.set(track.position.x, track.position.y, track.position.z);
      sceneRef.current?.add(ptzGroup);
      objectsRef.current.push(ptzGroup);
      ptzCameraRef.current = ptzGroup;
    });

  }, [dimensions, ptzTracks]); // Update when dimensions or PTZ tracks change

  return (
    <div 
      ref={containerRef} 
      className="w-full h-[400px] border border-border rounded-lg shadow-classic"
    />
  );
};
