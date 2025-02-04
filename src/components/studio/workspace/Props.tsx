import * as THREE from 'three';

interface CreatePropsProps {
  props: {
    toolBox: boolean;
    carLift: boolean;
    car: boolean;
  };
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  scene: THREE.Scene;
}

export const createProps = ({ props, dimensions, scene }: CreatePropsProps) => {
  const propsGroup: THREE.Group[] = [];

  if (props.toolBox) {
    const toolBox = new THREE.Group();
    const boxGeometry = new THREE.BoxGeometry(2, 2, 1);
    const boxMaterial = new THREE.MeshPhongMaterial({ color: 0xff0000 });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    box.position.set(-dimensions.width / 4, 1, -dimensions.length / 4);
    toolBox.add(box);
    scene.add(toolBox);
    propsGroup.push(toolBox);
  }

  if (props.carLift) {
    const carLift = new THREE.Group();
    const baseGeometry = new THREE.BoxGeometry(6, 0.5, 12);
    const baseMaterial = new THREE.MeshPhongMaterial({ color: 0x666666 });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.set(0, 0.25, 0);
    carLift.add(base);

    const postGeometry = new THREE.BoxGeometry(0.5, 4, 0.5);
    const postMaterial = new THREE.MeshPhongMaterial({ color: 0x444444 });
    
    const posts: THREE.Mesh[] = [];
    const postPositions = [
      [-2.75, 2, -5.75],
      [2.75, 2, -5.75],
      [-2.75, 2, 5.75],
      [2.75, 2, 5.75]
    ];

    postPositions.forEach(position => {
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.set(...position);
      carLift.add(post);
      posts.push(post);
    });

    carLift.position.set(dimensions.width / 4, 0, 0);
    scene.add(carLift);
    propsGroup.push(carLift);
  }

  if (props.car) {
    const car = new THREE.Group();
    
    // Car body
    const bodyGeometry = new THREE.BoxGeometry(6, 2, 12);
    const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x0066cc });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 2;
    car.add(body);

    // Wheels
    const wheelGeometry = new THREE.CylinderGeometry(1, 1, 0.5, 16);
    const wheelMaterial = new THREE.MeshPhongMaterial({ color: 0x222222 });
    const wheelPositions = [
      [-3, 1, -3],
      [3, 1, -3],
      [-3, 1, 3],
      [3, 1, 3]
    ];

    wheelPositions.forEach(position => {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(...position);
      car.add(wheel);
    });

    car.position.set(dimensions.width / 4, 0, 0);
    scene.add(car);
    propsGroup.push(car);
  }

  return propsGroup;
};