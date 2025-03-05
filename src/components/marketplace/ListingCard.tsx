
import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  Heart,
  Lock
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from 'date-fns';
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from '@/hooks/use-auth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useAtom } from 'jotai';
import { authRequiredModalAtom } from '@/components/auth/AuthRequiredModal';

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
  const navigate = useNavigate();
  const { session } = useAuth();
  const [, setAuthModal] = useAtom(authRequiredModalAtom);
  const { isWatched, toggleWatchlist } = useWatchlist();
  
  const isAuthenticated = !!session;
  const isItemWatched = isWatched(id, 'listing');
  
  const handleWatchToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // If not authenticated, show auth modal
    if (!isAuthenticated) {
      setAuthModal({
        isOpen: true,
        message: "Sign in to add listings to your watchlist",
        actionType: "watch"
      });
      return;
    }
    
    // Toggle item in watchlist
    const wasWatched = isItemWatched;
    toggleWatchlist(id, 'listing');
    
    // Show toast notification
    toast({
      title: wasWatched ? "Removed from watchlist" : "Added to watchlist",
      description: wasWatched 
        ? "This listing has been removed from your watchlist." 
        : "This listing has been added to your watchlist. We'll notify you of any updates.",
    });
  };
  
  const handleCardClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    console.log("Card clicked, navigating to listing detail:", id);
    navigate(`/marketplace/listing/${id}`);
  };
  
  const formattedDate = formatDistanceToNow(new Date(createdAt), { addSuffix: true });
  
  return (
    <Card className="overflow-hidden h-full flex flex-col hover:shadow-md transition-shadow">
      <Link 
        to={`/marketplace/listing/${id}`} 
        className="relative block"
        onClick={handleCardClick}
      >
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
          <Link 
            to={`/marketplace/listing/${id}`} 
            className="hover:underline"
            onClick={handleCardClick}
          >
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
          {!isAuthenticated ? (
            <>
              <Lock className="h-4 w-4 mr-1" />
              <span className="text-xs">Watch</span>
            </>
          ) : (
            <>
              <Heart 
                className="h-4 w-4 mr-1" 
                fill={isItemWatched ? "currentColor" : "none"} 
              />
              <span className="text-xs">{isItemWatched ? "Watching" : "Watch"}</span>
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
};
