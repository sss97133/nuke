
import { Vehicle } from '@/components/vehicles/discovery/types';

export interface VehicleCommentsProps {
  vehicle: Vehicle;
}

export interface Comment {
  id: number;
  user: {
    name: string;
    avatar: string | null;
    verificationLevel: 'none' | 'basic' | 'expert' | 'owner';
    isInfluencer: boolean;
  };
  text: string;
  timestamp: string;
  likes: number;
  isPrivate: boolean;
  replies: Comment[];
}
