
import { Car, Package, Wrench, TrendingUp } from "lucide-react";
import { FeedItem } from "@/types/feed";

interface ActivityFeedItemProps {
  item: FeedItem;
}

export const ActivityFeedItem = ({ item }: ActivityFeedItemProps) => {
  const getFeedItemContent = (item: FeedItem) => {
    switch (item.type) {
      case 'vehicle':
        return `New vehicle added: ${item.data?.make || ''} ${item.data?.model || ''}`;
      case 'asset':
        return `Asset updated: ${item.data?.name || ''}`;
      case 'service':
        return `Service ticket: ${item.data?.description || 'No description'}`;
      case 'auction':
        return `New auction: ${item.data?.title || 'Untitled auction'}`;
      default:
        return 'Unknown update';
    }
  };

  return (
    <div className="flex items-center gap-4 p-2 hover:bg-accent/50 rounded-sm cursor-pointer">
      {item.type === 'vehicle' && <Car className="h-4 w-4" />}
      {item.type === 'asset' && <Package className="h-4 w-4" />}
      {item.type === 'service' && <Wrench className="h-4 w-4" />}
      {item.type === 'auction' && <TrendingUp className="h-4 w-4" />}
      <div>
        <p className="text-sm">{getFeedItemContent(item)}</p>
        <p className="text-xs text-muted-foreground">
          {new Date(item.created_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
};
