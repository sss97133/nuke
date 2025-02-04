export interface TrackMovement {
  amplitude: { x: number; z: number };
  frequency: number;
  phase: number;
}

export interface PTZTrack {
  position: {
    x: number;
    y: number;
    z: number;
  };
  length: number;
  speed: number;
  coneAngle: number;
  movement: TrackMovement;
}

export interface StudioConfigV2 {
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  humanPosition: {
    x: number;
    y: number;
    z: number;
  };
  cameras: {
    frontWall: boolean;
    backWall: boolean;
    leftWall: boolean;
    rightWall: boolean;
    ceiling: boolean;
    showCone: boolean;
  };
  props: {
    toolBox: boolean;
    carLift: boolean;
    car: boolean;
  };
  ptzTracks: PTZTrack[];
}