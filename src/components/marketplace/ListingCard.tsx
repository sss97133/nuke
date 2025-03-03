
import React from 'react';
import { Link } from 'react-router-dom';
import { 
  Card, 
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { 
  Eye, 
  MessageSquare, 
  Clock, 
  MapPin,
  Heart
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from 'date-fns';
import { useToast } from "@/components/ui/use-toast";

interface ListingCardProps {
  id: string;
  title: string;
  price: number;
  imageUrl: string;
  location: string;
  createdAt: string;
  condition: string;
  viewCount: number;
  commentCount: number;
  isFeatured?: boolean;
}

export const ListingCard = ({
  id,
  title,
  price,
  imageUrl,
  location,
  createdAt,
  condition,
  viewCount,
  commentCount,
  isFeatured = false
}: ListingCardProps) => {
  const { toast } = useToast();
  const [isWatched, setIsWatched] = React.useState(false);
  
  const handleWatchToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsWatched(!isWatched);
    toast({
      title: isWatched ? "Removed from watchlist" : "Added to watchlist",
      description: isWatched ? "This listing has been removed from your watchlist." : "This listing has been added to your watchlist.",
    });
  };
  
  const formattedDate = formatDistanceToNow(new Date(createdAt), { addSuffix: true });
  
  return (
    <Card className="overflow-hidden h-full flex flex-col hover:shadow-md transition-shadow">
      <Link to={`/marketplace/listing/${id}`} className="relative block">
        <div 
          className="h-48 bg-cover bg-center w-full"
          style={{ backgroundImage: `url(${imageUrl})` }}
        />
        {isFeatured && (
          <Badge className="absolute top-2 right-2" variant="secondary">
            Featured
          </Badge>
        )}
      </Link>
      
      <CardHeader className="pb-2">
        <CardTitle className="text-lg truncate">
          <Link to={`/marketplace/listing/${id}`} className="hover:underline">
            {title}
          </Link>
        </CardTitle>
        <div className="flex justify-between items-center">
          <p className="text-2xl font-bold">${price.toLocaleString()}</p>
          <Badge variant="outline">{condition}</Badge>
        </div>
      </CardHeader>
      
      <CardContent className="pb-0 flex-grow">
        <div className="flex items-center text-muted-foreground text-sm mb-2">
          <MapPin className="h-3.5 w-3.5 mr-1" />
          <span className="truncate">{location}</span>
        </div>
        
        <div className="flex items-center text-muted-foreground text-sm">
          <Clock className="h-3.5 w-3.5 mr-1" />
          <span>{formattedDate}</span>
        </div>
      </CardContent>
      
      <CardFooter className="pt-4 flex justify-between">
        <div className="flex space-x-3 text-sm text-muted-foreground">
          <div className="flex items-center">
            <Eye className="h-3.5 w-3.5 mr-1" />
            <span>{viewCount}</span>
          </div>
          <div className="flex items-center">
            <MessageSquare className="h-3.5 w-3.5 mr-1" />
            <span>{commentCount}</span>
          </div>
        </div>
        
        <Button 
          variant="ghost" 
          size="sm" 
          className="p-0 h-auto"
          onClick={handleWatchToggle}
        >
          <Heart 
            className="h-4 w-4 mr-1" 
            fill={isWatched ? "currentColor" : "none"} 
          />
          <span className="text-xs">{isWatched ? "Watching" : "Watch"}</span>
        </Button>
      </CardFooter>
    </Card>
  );
};
