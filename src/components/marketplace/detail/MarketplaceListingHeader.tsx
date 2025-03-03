
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heart, Share2, MapPin, Clock, Eye } from 'lucide-react';
import { Separator } from "@/components/ui/separator";
import { formatDistanceToNow } from 'date-fns';
import { MarketplaceListing } from '../hooks/useMarketplaceListing';
import { useToast } from '@/components/ui/use-toast';

interface MarketplaceListingHeaderProps {
  listing: MarketplaceListing;
}

const MarketplaceListingHeader: React.FC<MarketplaceListingHeaderProps> = ({ listing }) => {
  const { toast } = useToast();
  const [isWatched, setIsWatched] = React.useState(listing.is_watched || false);
  
  const handleWatchToggle = () => {
    setIsWatched(!isWatched);
    toast({
      title: isWatched ? "Removed from watchlist" : "Added to watchlist",
      description: isWatched ? "This listing has been removed from your watchlist." : "This listing has been added to your watchlist.",
    });
  };
  
  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: listing.title,
        text: `Check out this ${listing.vehicle.year} ${listing.vehicle.make} ${listing.vehicle.model}`,
        url: window.location.href,
      }).catch(err => {
        console.error('Error sharing:', err);
      });
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast({
        title: "Link copied",
        description: "The link to this listing has been copied to your clipboard.",
      });
    }
  };

  const formattedDate = formatDistanceToNow(new Date(listing.created_at), { addSuffix: true });
  
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-xl md:text-2xl lg:text-3xl">{listing.title}</CardTitle>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-muted-foreground">
              <div className="flex items-center">
                <MapPin className="h-4 w-4 mr-1" />
                <span>{listing.location.city}, {listing.location.state}</span>
              </div>
              <div className="flex items-center">
                <Clock className="h-4 w-4 mr-1" />
                <span>Listed {formattedDate}</span>
              </div>
              <div className="flex items-center">
                <Eye className="h-4 w-4 mr-1" />
                <span>{listing.views_count} views</span>
              </div>
            </div>
          </div>
          
          <div className="flex flex-col items-end">
            <div className="text-3xl font-bold">
              ${listing.price.toLocaleString()}
            </div>
            {listing.is_featured && (
              <Badge className="mt-1" variant="secondary">
                Featured
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        <Separator className="my-4" />
        
        <div className="flex flex-wrap gap-2 justify-between items-center">
          <div>
            <Badge variant="outline" className="mr-2">
              {listing.condition} Condition
            </Badge>
            <Badge variant="outline">
              {listing.vehicle.year} {listing.vehicle.make} {listing.vehicle.model}
            </Badge>
          </div>
          
          <div className="flex gap-2">
            <Button 
              variant={isWatched ? "default" : "outline"}
              size="sm" 
              onClick={handleWatchToggle}
            >
              <Heart className="h-4 w-4 mr-1" fill={isWatched ? "currentColor" : "none"} />
              {isWatched ? "Watching" : "Watch"}
            </Button>
            
            <Button variant="outline" size="sm" onClick={handleShare}>
              <Share2 className="h-4 w-4 mr-1" />
              Share
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MarketplaceListingHeader;
