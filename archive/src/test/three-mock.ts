import { vi } from 'vitest';

// Mock Three.js Color
class Color {
  r: number = 1;
  g: number = 1;
  b: number = 1;

  constructor(hex?: number) {
    if (hex !== undefined) {
      this.setHex(hex);
    }
  }

  setHex(hex: number) {
    this.r = (hex >> 16 & 255) / 255;
    this.g = (hex >> 8 & 255) / 255;
    this.b = (hex & 255) / 255;
    return this;
  }
}

// Mock Three.js Vector3
class Vector3 {
  x: number = 0;
  y: number = 0;
  z: number = 0;
  
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  clone() {
    return new Vector3(this.x, this.y, this.z);
  }

  copy(v: Vector3) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  dot(v: Vector3) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  normalize() {
    const length = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    if (length > 0) {
      this.x /= length;
      this.y /= length;
      this.z /= length;
    }
    return this;
  }

  cross(v: Vector3) {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  applyQuaternion(q: Quaternion) {
    const x = this.x, y = this.y, z = this.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;

    // calculate quat * vector
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;

    // calculate result * inverse quat
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;

    return this;
  }
}

// Mock Three.js Camera
class PerspectiveCamera {
  position: Vector3;
  rotation: Vector3;
  
  constructor() {
    this.position = new Vector3();
    this.rotation = new Vector3();
  }
}

// Mock Three.js Scene
class Scene {
  add = vi.fn();
  remove = vi.fn();
  userData: Record<string, any> = {};
  background: any = null;
}

// Mock OrbitControls
const OrbitControls = vi.fn().mockImplementation((camera, domElement) => ({
  target: new Vector3(),
  target0: new Vector3(),
  position0: camera.position.clone(),
  zoom0: camera.zoom || 1,
  update: vi.fn(),
  dispose: vi.fn()
}));

// Mock Quaternion
class Quaternion {
  x: number = 0;
  y: number = 0;
  z: number = 0;
  w: number = 1;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  setFromUnitVectors(vFrom: Vector3, vTo: Vector3) {
    const r = vFrom.dot(vTo) + 1;
    if (r < Number.EPSILON) {
      this.x = 0;
      this.y = 1;
      this.z = 0;
      this.w = 0;
    } else {
      const v1 = new Vector3();
      v1.copy(vFrom).cross(vTo);
      this.x = v1.x;
      this.y = v1.y;
      this.z = v1.z;
      this.w = r;
    }
    return this.normalize();
  }

  normalize() {
    let len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    if (len === 0) {
      this.x = 0;
      this.y = 0;
      this.z = 0;
      this.w = 1;
    } else {
      len = 1 / len;
      this.x *= len;
      this.y *= len;
      this.z *= len;
      this.w *= len;
    }
    return this;
  }

  multiply(q: Quaternion) {
    const qax = this.x, qay = this.y, qaz = this.z, qaw = this.w;
    const qbx = q.x, qby = q.y, qbz = q.z, qbw = q.w;

    this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;

    return this;
  }

  inverse() {
    this.x *= -1;
    this.y *= -1;
    this.z *= -1;
    return this;
  }
}

// Export mocks
export const mockThree = {
  Scene,
  PerspectiveCamera,
  Vector3,
  Color,
  Quaternion,
  WebGLRenderer: vi.fn(() => ({
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    domElement: document.createElement('canvas'),
    shadowMap: { enabled: false }
  })),
  AmbientLight: vi.fn(),
  DirectionalLight: vi.fn(),
  GridHelper: vi.fn(),
  Clock: vi.fn(() => ({
    getElapsedTime: () => 0
  }))
};

// Export OrbitControls separately since it's from examples
export { OrbitControls };
