import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { WorkspaceDimensions } from '../types/workspace';

interface SpatialLMAnalysisProps {
  dimensions: WorkspaceDimensions;
  coverageScore: number;
  blindSpots: Array<{
    position: { x: number; y: number; z: number };
    radius: number;
  }>;
  scene: THREE.Scene;
}

export const SpatialLMAnalysis: React.FC<SpatialLMAnalysisProps> = ({
  dimensions,
  coverageScore,
  blindSpots,
  scene
}) => {
  const blindSpotObjectsRef = useRef<(THREE.Mesh | THREE.LineSegments)[]>([]);
  const coverageTextRef = useRef<THREE.Sprite | null>(null);

  useEffect(() => {
    // Clear existing blind spot meshes
    blindSpotObjectsRef.current.forEach(obj => {
      scene.remove(obj);
    });
    blindSpotObjectsRef.current = [];

    // Create blind spot visualizations
    blindSpots.forEach(blindSpot => {
      // Create a semi-transparent sphere for the blind spot
      const sphereGeometry = new THREE.SphereGeometry(blindSpot.radius, 32, 32);
      const sphereMaterial = new THREE.MeshPhongMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.2,
        wireframe: true
      });
      const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
      sphere.position.set(
        blindSpot.position.x,
        blindSpot.position.y,
        blindSpot.position.z
      );
      scene.add(sphere);
      blindSpotObjectsRef.current.push(sphere);

      // Add wireframe to make it more visible
      const wireframeGeometry = new THREE.WireframeGeometry(sphereGeometry);
      const wireframeMaterial = new THREE.LineBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.5
      });
      const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
      wireframe.position.copy(sphere.position);
      scene.add(wireframe);
      blindSpotObjectsRef.current.push(wireframe);
    });

    // Create coverage score text
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) {
      canvas.width = 256;
      canvas.height = 64;
      context.fillStyle = 'rgba(0, 0, 0, 0.5)';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = 'bold 32px Arial';
      context.fillStyle = coverageScore > 0.8 ? '#00ff00' : '#ff0000';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(
        `Coverage: ${Math.round(coverageScore * 100)}%`,
        canvas.width / 2,
        canvas.height / 2
      );

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.scale.set(5, 1.25, 1);
      sprite.position.set(0, dimensions.height + 1, 0);
      sprite.renderOrder = 1;

      if (coverageTextRef.current) {
        scene.remove(coverageTextRef.current);
      }
      scene.add(sprite);
      coverageTextRef.current = sprite;
    }

    return () => {
      // Cleanup
      blindSpotObjectsRef.current.forEach(obj => {
        scene.remove(obj);
      });
      if (coverageTextRef.current) {
        scene.remove(coverageTextRef.current);
      }
    };
  }, [scene, dimensions, coverageScore, blindSpots]);

  return null; // This component doesn't render anything directly
}; 