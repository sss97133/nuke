
import React, { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SunIcon, Lightbulb } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBasicStudioLighting, createProductLighting } from '@/components/studio/utils/studioLighting';
import type { WorkspaceDimensions, PTZTrack } from '../types/workspace';

interface StudioPreviewProps {
  dimensions: WorkspaceDimensions;
  ptzTracks: PTZTrack[];
  selectedCameraIndex: number | null;
  onCameraSelect: (index: number) => void;
  lightMode: 'basic' | 'product';
  setLightMode: (mode: 'basic' | 'product') => void;
}

export const StudioPreview: React.FC<StudioPreviewProps> = ({ 
  dimensions, 
  ptzTracks, 
  selectedCameraIndex, 
  onCameraSelect,
  lightMode,
  setLightMode
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraModelsRef = useRef<THREE.Group[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);
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
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    scene.userData.renderer = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    const floorGeometry = new THREE.PlaneGeometry(dimensions.length, dimensions.width);
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x333333, 
      roughness: 0.8 
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
    
    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(dimensions.length, dimensions.height), 
      wallMaterial
    );
    backWall.position.z = -dimensions.width / 2;
    backWall.position.y = dimensions.height / 2;
    backWall.receiveShadow = true;
    scene.add(backWall);

    const boxGeometry = new THREE.BoxGeometry(2, 2, 2);
    const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x3366ff });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    box.position.y = 1;
    box.castShadow = true;
    scene.add(box);

    // Create camera models for each PTZ track
    cameraModelsRef.current = ptzTracks.map((track, index) => {
      const cameraGroup = new THREE.Group();
      
      // Camera body
      const cameraBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.8, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x222222 })
      );
      cameraBody.castShadow = true;
      cameraGroup.add(cameraBody);
      
      // Camera lens
      const cameraLens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.5, 16),
        new THREE.MeshStandardMaterial({ color: 0x111111 })
      );
      cameraLens.rotation.x = Math.PI / 2;
      cameraLens.position.z = 0.85;
      cameraGroup.add(cameraLens);
      
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
      return cameraGroup;
    });

    if (lightMode === 'basic') {
      createBasicStudioLighting(scene);
    } else {
      createProductLighting(scene);
    }

    // Handle camera selection through raycasting
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    
    const handleMouseClick = (event: MouseEvent) => {
      if (!containerRef.current || !cameraRef.current || !sceneRef.current) return;
      
      // Calculate mouse position in normalized device coordinates
      const rect = containerRef.current.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / containerRef.current.clientWidth) * 2 - 1;
      mouse.y = - ((event.clientY - rect.top) / containerRef.current.clientHeight) * 2 + 1;
      
      // Update the picking ray with the camera and mouse position
      raycaster.setFromCamera(mouse, cameraRef.current);
      
      // Calculate objects intersecting the ray
      const intersects = raycaster.intersectObjects(sceneRef.current.children, true);
      
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

  // Update camera positions when ptzTracks change
  useEffect(() => {
    if (!sceneRef.current) return;
    
    // Update existing camera models
    ptzTracks.forEach((track, index) => {
      if (index < cameraModelsRef.current.length) {
        const cameraGroup = cameraModelsRef.current[index];
        cameraGroup.position.set(track.position.x, track.position.y, track.position.z);
        
        if (track.target) {
          const targetVector = new THREE.Vector3(track.target.x, track.target.y, track.target.z);
          cameraGroup.lookAt(targetVector);
        }
      }
    });
  }, [ptzTracks]);

  // Update lighting when lightMode changes
  useEffect(() => {
    if (!sceneRef.current) return;
    
    // Remove existing lights
    sceneRef.current.children.forEach(child => {
      if (child.type === 'DirectionalLight' || child.type === 'AmbientLight' || 
          child.type === 'SpotLight' || child.type === 'Group' || child.type === 'RectAreaLight') {
        sceneRef.current?.remove(child);
      }
    });
    
    // Add new lights based on current mode
    if (lightMode === 'basic') {
      createBasicStudioLighting(sceneRef.current);
    } else {
      createProductLighting(sceneRef.current);
    }
  }, [lightMode]);

  const changeLighting = (mode: 'basic' | 'product') => {
    setLightMode(mode);
  };

  return (
    <div className="relative h-full">
      <div 
        ref={containerRef} 
        className="w-full aspect-video bg-black rounded-md overflow-hidden"
      />
      <div className="absolute bottom-4 right-4 flex space-x-2">
        <Button 
          variant={lightMode === 'basic' ? "default" : "outline"} 
          size="sm"
          onClick={() => changeLighting('basic')}
        >
          <SunIcon className="h-4 w-4 mr-2" />
          Studio Lighting
        </Button>
        <Button 
          variant={lightMode === 'product' ? "default" : "outline"} 
          size="sm"
          onClick={() => changeLighting('product')}
        >
          <Lightbulb className="h-4 w-4 mr-2" />
          Product Lighting
        </Button>
      </div>
    </div>
  );
};
