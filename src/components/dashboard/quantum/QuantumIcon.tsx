
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface QuantumIconProps {
  className?: string;
}

export const QuantumIcon = ({ className }: QuantumIconProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    renderer.setSize(16, 16);
    
    containerRef.current.appendChild(renderer.domElement);

    // Create orbital ring
    const orbitalGeometry = new THREE.TorusGeometry(0.6, 0.05, 16, 100);
    const orbitalMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x3366ff,
      transparent: true,
      opacity: 0.8
    });
    const orbital = new THREE.Mesh(orbitalGeometry, orbitalMaterial);
    orbital.rotation.x = Math.PI / 2;
    scene.add(orbital);

    // Create particle system
    const particlesGeometry = new THREE.BufferGeometry();
    const particleCount = 20;
    const positions = new Float32Array(particleCount * 3);
    
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      positions[i * 3] = Math.cos(angle) * 0.6;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = Math.sin(angle) * 0.6;
    }
    
    particlesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const particlesMaterial = new THREE.PointsMaterial({
      color: 0x3366ff,
      size: 0.1,
      transparent: true,
      opacity: 0.8
    });
    
    const particles = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particles);

    // Position camera
    camera.position.z = 3;

    // Animation
    const animate = () => {
      requestAnimationFrame(animate);
      
      orbital.rotation.z += 0.01;
      particles.rotation.y += 0.02;
      
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      if (containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={containerRef} className={className} />;
};
