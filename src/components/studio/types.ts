export interface PTZTrack {
  position: {
    x: number;
    y: number;
    z: number;
  };
  length: number;
  speed: number;
  coneAngle: number;
}