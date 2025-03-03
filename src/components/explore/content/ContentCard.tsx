
import React from 'react';
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Info, ThumbsUp, Share2, Bookmark, ExternalLink } from 'lucide-react';

export interface ContentCardItem {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  image: string;
  tags: string[];
  reason: string;
  location: string;
  relevanceScore: number;
  trending?: string;
}

interface ContentCardProps {
  item: ContentCardItem;
  showTrending?: boolean;
  onView?: (id: string) => void;
  onLike?: (id: string) => void;
  onShare?: (id: string) => void;
  onSave?: (id: string) => void;
}

export const ContentCard = ({ 
  item, 
  showTrending,
  onView,
  onLike,
  onShare,
  onSave 
}: ContentCardProps) => {
  const { id, title, subtitle, image, tags, location, reason, type, trending } = item;
  
  // Choose background color based on content type
  const getBgColor = () => {
    switch (type) {
      case 'vehicle':
        return 'bg-blue-50 dark:bg-blue-950/20';
      case 'auction':
        return 'bg-amber-50 dark:bg-amber-950/20';
      case 'event':
        return 'bg-green-50 dark:bg-green-950/20';
      case 'garage':
        return 'bg-purple-50 dark:bg-purple-950/20';
      case 'article':
        return 'bg-teal-50 dark:bg-teal-950/20';
      default:
        return 'bg-gray-50 dark:bg-gray-800/20';
    }
  };

  // Track view when card is rendered
  React.useEffect(() => {
    if (onView) {
      onView(id);
    }
  }, [id, onView]);
  
  return (
    <Card className={`overflow-hidden ${getBgColor()} border-0 shadow-md`}>
      <div className="relative h-48 overflow-hidden">
        <img 
          src={image} 
          alt={title}
          className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
        />
        <div className="absolute top-2 left-2">
          <Badge variant="secondary" className="capitalize font-medium">
            {type}
          </Badge>
        </div>
        
        {showTrending && trending && (
          <div className="absolute top-2 right-2">
            <Badge variant="outline" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
              {trending}
            </Badge>
          </div>
        )}
      </div>
      
      <CardHeader className="pb-2">
        <h3 className="text-lg font-semibold leading-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </CardHeader>
      
      <CardContent className="space-y-3 pb-2">
        <div className="flex flex-wrap gap-1">
          {tags.map((tag, index) => (
            <Badge key={index} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
        
        <div className="flex items-start gap-1">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
          <span className="text-sm">{location}</span>
        </div>
        
        <div className="flex items-start gap-1">
          <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
          <span className="text-xs text-muted-foreground">{reason}</span>
        </div>
      </CardContent>
      
      <CardFooter className="pt-0 flex flex-col gap-2">
        <Button variant="secondary" size="sm" className="w-full">
          View Details
          <ExternalLink className="ml-1 h-3 w-3" />
        </Button>
        
        <div className="flex justify-between w-full">
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex-1"
            onClick={() => onLike && onLike(id)}
          >
            <ThumbsUp className="h-4 w-4" />
          </Button>
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex-1"
            onClick={() => onShare && onShare(id)}
          >
            <Share2 className="h-4 w-4" />
          </Button>
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex-1"
            onClick={() => onSave && onSave(id)}
          >
            <Bookmark className="h-4 w-4" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
