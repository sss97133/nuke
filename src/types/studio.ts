import { Json } from '@/integrations/supabase/types';
import { isRecord } from './json';

export interface WorkspaceDimensions {
  width: number;
  height: number;
  length: number;
}

export interface PTZTrackPosition {
  x: number;
  y: number;
  z: number;
}

export interface PTZTrack {
  position: PTZTrackPosition;
  length: number;
  speed: number;
  coneAngle: number;
}

export interface PTZPlanes {
  walls: any[];
  ceiling: Record<string, any>;
}

export interface PTZConfigurations {
  tracks: PTZTrack[];
  planes: PTZPlanes;
  roboticArms: any[];
}

export interface StudioConfigurationType {
  id: string;
  user_id: string;
  name: string;
  workspace_dimensions: WorkspaceDimensions;
  ptz_configurations: PTZConfigurations;
  camera_config: Record<string, any>;
  audio_config: Record<string, any>;
  lighting_config: Record<string, any>;
  fixed_cameras: { positions: any[] };
  created_at: string;
  updated_at: string;
}

export interface StudioDimensionsProps {
  dimensions: WorkspaceDimensions;
  onUpdate: (dimensions: WorkspaceDimensions) => void;
}

export interface PTZConfigurationProps {
  ptzTracks: PTZTrack[];
  onUpdate: (tracks: PTZTrack[]) => void;
}

export const isWorkspaceDimensions = (json: Json | null): json is WorkspaceDimensions => {
  if (!isRecord(json)) return false;
  return (
    typeof json.width === 'number' &&
    typeof json.height === 'number' &&
    typeof json.length === 'number'
  );
};

export const isPTZConfigurations = (json: Json | null): json is PTZConfigurations => {
  if (!isRecord(json)) return false;
  return (
    Array.isArray(json.tracks) &&
    isRecord(json.planes) &&
    Array.isArray(json.planes.walls) &&
    isRecord(json.planes.ceiling) &&
    Array.isArray(json.roboticArms)
  );
};