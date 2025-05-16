
import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface AnimationRefs {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  controls: OrbitControls | null;
  animationFrameId: number | null;
}

export const useQuantumAnimation = () => {
  const refs = useRef<AnimationRefs>({
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    animationFrameId: null
  });

  const startAnimation = useCallback((
    animate: (time: number) => void
  ) => {
    if (refs.current.animationFrameId !== null) {
      cancelAnimationFrame(refs.current.animationFrameId);
    }

    const animationLoop = () => {
      const time = Date.now() * 0.001;
      
      if (refs.current.controls) {
        refs.current.controls.update();
      }
      
      // Call the animate function
      animate(time);
      
      // Render the scene
      if (refs.current.camera && refs.current.renderer && refs.current.scene) {
        refs.current.renderer.render(refs.current.scene, refs.current.camera);
      }
      
      refs.current.animationFrameId = requestAnimationFrame(animationLoop);
    };
    
    refs.current.animationFrameId = requestAnimationFrame(animationLoop);
    
    return () => {
      if (refs.current.animationFrameId !== null) {
        cancelAnimationFrame(refs.current.animationFrameId);
        refs.current.animationFrameId = null;
      }
    };
  }, []);

  const setSceneRefs = useCallback((
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    controls: OrbitControls
  ) => {
    refs.current.scene = scene;
    refs.current.camera = camera;
    refs.current.renderer = renderer;
    refs.current.controls = controls;
  }, []);

  return {
    refs: refs.current,
    startAnimation,
    setSceneRefs
  };
};
