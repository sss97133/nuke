import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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

    // Create human figure (6 feet tall)
    const createHuman = () => {
      if (humanRef.current) {
        scene.remove(humanRef.current);
      }

      const human = new THREE.Group();
      const humanHeight = 6;
      
      // Body
      const bodyGeometry = new THREE.CylinderGeometry(0.4, 0.4, humanHeight/3, 8);
      const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x0000ff });
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
      body.position.y = humanHeight/6;
      human.add(body);

      // Head
      const headGeometry = new THREE.SphereGeometry(0.4, 8, 8);
      const headMaterial = new THREE.MeshPhongMaterial({ color: 0xffcc99 });
      const head = new THREE.Mesh(headGeometry, headMaterial);
      head.position.y = humanHeight/3 + 0.4;
      human.add(head);

      // Legs
      const legGeometry = new THREE.CylinderGeometry(0.2, 0.2, humanHeight/2, 8);
      const legMaterial = new THREE.MeshPhongMaterial({ color: 0x0000ff });
      
      const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
      leftLeg.position.set(0.3, humanHeight/4, 0);
      human.add(leftLeg);
      
      const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
      rightLeg.position.set(-0.3, humanHeight/4, 0);
      human.add(rightLeg);

      // Position at specified coordinates
      human.position.set(humanPosition.x, humanPosition.y, humanPosition.z);
      scene.add(human);
      humanRef.current = human;
    };

    createHuman();

    // Create PTZ camera
    const createPTZCamera = () => {
      if (ptzCameraRef.current) {
        scene.remove(ptzCameraRef.current);
      }

      if (ptzTracks && ptzTracks.length > 0) {
        const track = ptzTracks[0];
        const ptzGroup = new THREE.Group();
        
        // Track
        const trackGeometry = new THREE.BoxGeometry(track.length, 0.2, 0.2);
        const trackMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
        const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
        trackMesh.position.x = track.length / 2;
        ptzGroup.add(trackMesh);
        
        // Camera body
        const cameraBody = new THREE.BoxGeometry(0.5, 0.5, 0.8);
        const cameraMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
        const cameraMesh = new THREE.Mesh(cameraBody, cameraMaterial);
        ptzGroup.add(cameraMesh);
        
        // Camera cone (if enabled)
        if (cameras.showCone) {
          const coneHeight = dimensions.length / 2;
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
          cone.position.z = coneHeight / 2;
          ptzGroup.add(cone);
        }
        
        // Position PTZ camera
        ptzGroup.position.set(track.position.x, track.position.y, track.position.z);
        scene.add(ptzGroup);
        ptzCameraRef.current = ptzGroup;
      }
    };

    createPTZCamera();

    // Create fixed cameras
    const createFixedCameras = () => {
      // Remove existing fixed cameras
      fixedCamerasRef.current.forEach(camera => scene.remove(camera));
      fixedCamerasRef.current = [];

      const createCamera = (position: THREE.Vector3, lookAt: THREE.Vector3) => {
        const cameraGroup = new THREE.Group();
        
        // Camera body
        const cameraBody = new THREE.BoxGeometry(0.5, 0.5, 0.8);
        const cameraMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
        const cameraMesh = new THREE.Mesh(cameraBody, cameraMaterial);
        cameraGroup.add(cameraMesh);
        
        // Camera cone
        if (cameras.showCone) {
          const coneHeight = dimensions.length / 4;
          const coneGeometry = new THREE.ConeGeometry(
            Math.tan((45 * Math.PI) / 180) * coneHeight,
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
          cone.position.z = coneHeight / 2;
          cameraGroup.add(cone);
        }

        cameraGroup.position.copy(position);
        cameraGroup.lookAt(lookAt);
        scene.add(cameraGroup);
        fixedCamerasRef.current.push(cameraGroup);
      };

      // Add cameras based on configuration
      if (cameras.frontWall) {
        createCamera(
          new THREE.Vector3(0, dimensions.height * 0.8, dimensions.length / 2),
          new THREE.Vector3(0, dimensions.height * 0.4, 0)
        );
      }
      if (cameras.backWall) {
        createCamera(
          new THREE.Vector3(0, dimensions.height * 0.8, -dimensions.length / 2),
          new THREE.Vector3(0, dimensions.height * 0.4, 0)
        );
      }
      if (cameras.leftWall) {
        createCamera(
          new THREE.Vector3(-dimensions.width / 2, dimensions.height * 0.8, 0),
          new THREE.Vector3(0, dimensions.height * 0.4, 0)
        );
      }
      if (cameras.rightWall) {
        createCamera(
          new THREE.Vector3(dimensions.width / 2, dimensions.height * 0.8, 0),
          new THREE.Vector3(0, dimensions.height * 0.4, 0)
        );
      }
      if (cameras.ceiling) {
        createCamera(
          new THREE.Vector3(0, dimensions.height, 0),
          new THREE.Vector3(0, 0, 0)
        );
      }
    };

    createFixedCameras();

    // Animation loop
    const animate = () => {
      timeRef.current += 0.005;
      
      if (humanRef.current) {
        // Add slight bobbing motion
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
  }, [dimensions, humanPosition, cameras, ptzTracks]); // Re-run when these props change

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

  }, [dimensions, ptzTracks]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-[400px] border border-border rounded-lg shadow-classic"
    />
  );
};