
import * as THREE from 'three';
import type { PTZTrack } from '../types/workspace';

export const createPTZCamera = (
  scene: THREE.Scene, 
  track: PTZTrack, 
  maxDistance: number,
  isActive: boolean = false
) => {
  // Track
  const trackGeometry = new THREE.BoxGeometry(track.length, 0.2, 0.2);
  const trackMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x333333,
    specular: 0x999999,
    shininess: 100
  });
  const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
  trackMesh.position.set(track.position.x, track.position.y, track.position.z);
  trackMesh.receiveShadow = true;
  scene.add(trackMesh);

  // PTZ Camera group
  const ptzGroup = new THREE.Group();
  ptzGroup.position.set(track.position.x, track.position.y, track.position.z);
  
  // Camera mount (the part that slides on the track)
  const mountGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.6);
  const mountMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x444444,
    specular: 0x999999,
    shininess: 100
  });
  const mount = new THREE.Mesh(mountGeometry, mountMaterial);
  mount.position.y = 0.3;
  ptzGroup.add(mount);
  
  // Add details to mount (screws, panels)
  const detailsMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x222222,
    specular: 0x999999,
    shininess: 100
  });
  
  // Top panel
  const topPanelGeometry = new THREE.BoxGeometry(0.7, 0.05, 0.5);
  const topPanel = new THREE.Mesh(topPanelGeometry, detailsMaterial);
  topPanel.position.y = 0.4;
  mount.add(topPanel);
  
  // Add screws to corners
  const screwGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.1, 6);
  const screwMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x999999,
    specular: 0xffffff,
    shininess: 200
  });
  
  const screwPositions = [
    { x: 0.3, y: 0.3, z: 0.2 },
    { x: -0.3, y: 0.3, z: 0.2 },
    { x: 0.3, y: 0.3, z: -0.2 },
    { x: -0.3, y: 0.3, z: -0.2 }
  ];
  
  screwPositions.forEach(pos => {
    const screw = new THREE.Mesh(screwGeometry, screwMaterial);
    screw.position.set(pos.x, pos.y, pos.z);
    screw.rotation.x = Math.PI/2;
    mount.add(screw);
  });
  
  // Pan-tilt mechanism
  const panBase = new THREE.Group();
  panBase.position.y = 0.9;
  mount.add(panBase);
  
  // Pan motor housing
  const panMotorGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.3, 16);
  const panMotor = new THREE.Mesh(panMotorGeometry, mountMaterial);
  panBase.add(panMotor);
  
  // Tilt base
  const tiltBase = new THREE.Group();
  tiltBase.position.y = 0.2;
  panBase.add(tiltBase);
  
  // Tilt arms
  const tiltArmGeometry = new THREE.BoxGeometry(0.1, 0.4, 0.1);
  const leftTiltArm = new THREE.Mesh(tiltArmGeometry, mountMaterial);
  leftTiltArm.position.set(0.2, 0, 0);
  tiltBase.add(leftTiltArm);
  
  const rightTiltArm = new THREE.Mesh(tiltArmGeometry, mountMaterial);
  rightTiltArm.position.set(-0.2, 0, 0);
  tiltBase.add(rightTiltArm);
  
  // Camera body
  const cameraBodyGeometry = new THREE.BoxGeometry(0.6, 0.4, 0.8);
  const cameraBodyMaterial = new THREE.MeshPhongMaterial({ 
    color: isActive ? 0x002266 : 0x222222,
    specular: 0x999999,
    shininess: 100
  });
  const cameraBody = new THREE.Mesh(cameraBodyGeometry, cameraBodyMaterial);
  cameraBody.position.y = 0.4;
  tiltBase.add(cameraBody);
  
  // Camera lens
  const lensGeometry = new THREE.CylinderGeometry(0.15, 0.2, 0.4, 16);
  const glassMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x222222,
    specular: 0xaaaaaa,
    shininess: 200,
    transparent: true,
    opacity: 0.9
  });
  const lens = new THREE.Mesh(lensGeometry, glassMaterial);
  lens.rotation.x = Math.PI/2;
  lens.position.z = 0.6;
  cameraBody.add(lens);
  
  // Lens ring
  const lensRingGeometry = new THREE.TorusGeometry(0.18, 0.03, 8, 24);
  const lensRingMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x999999,
    specular: 0xffffff,
    shininess: 200
  });
  const lensRing = new THREE.Mesh(lensRingGeometry, lensRingMaterial);
  lensRing.rotation.y = Math.PI/2;
  lensRing.position.z = 0.4;
  cameraBody.add(lensRing);
  
  // Status LED
  const ledGeometry = new THREE.CircleGeometry(0.05, 8);
  const ledMaterial = new THREE.MeshBasicMaterial({ 
    color: isActive ? 0xff0000 : 0x00ff00,
    side: THREE.DoubleSide
  });
  const led = new THREE.Mesh(ledGeometry, ledMaterial);
  led.position.set(0.25, 0.1, 0.41);
  led.rotation.y = Math.PI/2;
  cameraBody.add(led);
  
  // Brand logo
  const logoGeometry = new THREE.PlaneGeometry(0.3, 0.1);
  const logoMaterial = new THREE.MeshBasicMaterial({ 
    color: 0xffffff,
    side: THREE.DoubleSide
  });
  const logo = new THREE.Mesh(logoGeometry, logoMaterial);
  logo.position.set(0, 0.1, 0.41);
  logo.rotation.y = Math.PI/2;
  cameraBody.add(logo);
  
  // Cable
  const cablePoints = [];
  cablePoints.push(new THREE.Vector3(0, 0, 0));
  cablePoints.push(new THREE.Vector3(0, -0.3, -0.1));
  cablePoints.push(new THREE.Vector3(0, -0.5, -0.2));
  cablePoints.push(new THREE.Vector3(0, -0.7, -0.1));
  cablePoints.push(new THREE.Vector3(0, -1, 0));
  
  const cableCurve = new THREE.CatmullRomCurve3(cablePoints);
  const cableGeometry = new THREE.TubeGeometry(cableCurve, 20, 0.03, 8, false);
  const cableMaterial = new THREE.MeshPhongMaterial({ color: 0x000000 });
  const cable = new THREE.Mesh(cableGeometry, cableMaterial);
  cameraBody.add(cable);

  // Camera cone (field of view) - only visible for active camera
  if (isActive) {
    const coneHeight = maxDistance;
    const coneRadius = Math.tan((track.coneAngle * Math.PI) / 180) * coneHeight;
    const coneGeometry = new THREE.ConeGeometry(coneRadius, coneHeight, 32);
    const coneMaterial = new THREE.MeshPhongMaterial({ 
      color: 0xff0000,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide
    });
    const cone = new THREE.Mesh(coneGeometry, coneMaterial);
    
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = coneHeight/2;
    cameraBody.add(cone);
    
    // Add wireframe to the cone
    const wireframeGeometry = new THREE.WireframeGeometry(coneGeometry);
    const wireframeMaterial = new THREE.LineBasicMaterial({ 
      color: 0xff4444,
      transparent: true,
      opacity: 0.2
    });
    const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
    wireframe.rotation.x = -Math.PI / 2;
    wireframe.position.z = coneHeight/2;
    cameraBody.add(wireframe);
  }

  scene.add(ptzGroup);
  
  // Add user data for raycasting
  ptzGroup.userData = { type: 'ptzCamera' };
  mount.userData = { type: 'ptzCamera' };
  cameraBody.userData = { type: 'ptzCamera' };

  return { trackMesh, ptzGroup };
};
