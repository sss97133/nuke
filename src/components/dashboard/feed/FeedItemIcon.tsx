import { Car, Package, Wrench, MessageSquare, Star, Activity, User } from "lucide-react";

export interface FeedItemIconProps {
  itemType: string;
}

export const FeedItemIcon = ({ itemType }: FeedItemIconProps) => {
  switch (itemType) {
    case 'vehicle':
      return <Car className="w-4 h-4" />;
    case 'inventory':
      return <Package className="w-4 h-4" />;
    case 'service':
      return <Wrench className="w-4 h-4" />;
    case 'comment':
      return <MessageSquare className="w-4 h-4" />;
    case 'achievement':
      return <Star className="w-4 h-4" />;
    case 'profile':
      return <User className="w-4 h-4" />;
    default:
      return <Activity className="w-4 h-4" />;
  }
};