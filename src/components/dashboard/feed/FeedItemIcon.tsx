
import { Car, Package, Wrench, MessageSquare, Star, Award, Box, Settings } from "lucide-react";

export interface FeedItemIconProps {
  itemType: string;
}

export const FeedItemIcon = ({ itemType }: FeedItemIconProps) => {
  switch (itemType) {
    case 'vehicle_added':
      return <Car className="w-4 h-4" />;
    case 'maintenance':
      return <Settings className="w-4 h-4" />;
    case 'certification':
      return <Award className="w-4 h-4" />;
    case 'inventory':
      return <Box className="w-4 h-4" />;
    case 'service':
      return <Wrench className="w-4 h-4" />;
    case 'comment':
      return <MessageSquare className="w-4 h-4" />;
    case 'achievement':
      return <Star className="w-4 h-4" />;
    default:
      return <MessageSquare className="w-4 h-4" />;
  }
};
