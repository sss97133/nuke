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
    // Position toolbox on the floor near the wall
    box.position.set(
      -dimensions.width / 4, 
      1, // Half height of box to sit on floor
      -dimensions.length / 4
    );
    toolBox.add(box);
    scene.add(toolBox);
    propsGroup.push(toolBox);
  }

  if (props.carLift) {
    const carLift = new THREE.Group();
    const baseGeometry = new THREE.BoxGeometry(6, 0.5, 12);
    const baseMaterial = new THREE.MeshPhongMaterial({ color: 0x666666 });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = 0.25; // Half height to sit on floor
    carLift.add(base);

    const postGeometry = new THREE.BoxGeometry(0.5, 4, 0.5);
    const postMaterial = new THREE.MeshPhongMaterial({ color: 0x444444 });
    
    const postPositions = [
      [-2.75, 2, -5.75],
      [2.75, 2, -5.75],
      [-2.75, 2, 5.75],
      [2.75, 2, 5.75]
    ];

    postPositions.forEach((position) => {
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.set(position[0], position[1], position[2]);
      carLift.add(post);
    });

    // Position car lift on floor in center
    carLift.position.set(
      dimensions.width / 4,
      0,
      0
    );
    scene.add(carLift);
    propsGroup.push(carLift);
  }

  if (props.car) {
    const car = new THREE.Group();
    
    // Car body
    const bodyGeometry = new THREE.BoxGeometry(6, 2, 12);
    const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x0066cc });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 1; // Half height to sit on floor
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

    wheelPositions.forEach((position) => {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(position[0], position[1], position[2]);
      car.add(wheel);
    });

    // Position car on floor near car lift
    car.position.set(
      dimensions.width / 4,
      0,
      0
    );
    scene.add(car);
    propsGroup.push(car);
  }

  return propsGroup;
};