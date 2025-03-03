
import React from 'react';
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Heart, 
  MessageCircle, 
  Eye, 
  Share2
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Link } from 'react-router-dom';

interface ListingCardProps {
  id: string;
  title: string;
  price: number | null;
  imageUrl: string;
  location: string;
  createdAt: string;
  condition?: string;
  viewCount: number;
  commentCount?: number;
  isFeatured?: boolean;
}

export const ListingCard: React.FC<ListingCardProps> = ({
  id,
  title,
  price,
  imageUrl,
  location,
  createdAt,
  condition,
  viewCount,
  commentCount = 0,
  isFeatured = false
}) => {
  return (
    <Card className="overflow-hidden h-full flex flex-col hover:shadow-md transition-shadow">
      <Link to={`/marketplace/listing/${id}`} className="relative">
        {isFeatured && (
          <Badge variant="secondary" className="absolute top-2 right-2 z-10">
            Featured
          </Badge>
        )}
        <div className="aspect-video relative overflow-hidden bg-muted">
          <img 
            src={imageUrl || '/placeholder.svg'} 
            alt={title}
            className="object-cover w-full h-full transition-transform hover:scale-105"
          />
        </div>
      </Link>
      
      <CardContent className="p-4 flex-grow">
        <div className="flex justify-between items-start mb-2">
          <h3 className="font-medium text-lg line-clamp-2">
            <Link to={`/marketplace/listing/${id}`} className="hover:underline">
              {title}
            </Link>
          </h3>
          <span className="font-semibold whitespace-nowrap">
            {price ? `$${price.toLocaleString()}` : 'Price on request'}
          </span>
        </div>
        
        <div className="text-sm text-muted-foreground">
          <div className="flex items-center gap-2 mb-1">
            <span>{location}</span>
            <span>•</span>
            <span>{formatDistanceToNow(new Date(createdAt), { addSuffix: true })}</span>
          </div>
          {condition && (
            <Badge variant="outline" className="mr-2">
              {condition}
            </Badge>
          )}
        </div>
      </CardContent>
      
      <CardFooter className="p-4 pt-0 flex justify-between border-t mt-auto">
        <div className="flex gap-3 text-muted-foreground text-sm">
          <span className="flex items-center gap-1">
            <Eye className="h-4 w-4" /> {viewCount}
          </span>
          <span className="flex items-center gap-1">
            <MessageCircle className="h-4 w-4" /> {commentCount}
          </span>
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-8 w-8">
            <Heart className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8">
            <Share2 className="h-4 w-4" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};
