
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, TrendingUp, ThumbsUp, Eye, Bookmark, Share2, Compass } from 'lucide-react';

interface ContentItem {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  image: string;
  tags: string[];
  reason: string;
  location: string;
  relevanceScore?: number;
  trending?: string;
}

interface ContentCardProps {
  item: ContentItem;
  showTrending?: boolean;
  isDiscovery?: boolean;
}

export const ContentCard = ({ item, showTrending, isDiscovery }: ContentCardProps) => {
  const getTypeIcon = () => {
    switch (item.type) {
      case 'vehicle':
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-200">Vehicle</Badge>;
      case 'auction':
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-200">Auction</Badge>;
      case 'event':
        return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-200">Event</Badge>;
      case 'garage':
        return <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-200">Garage</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };
  
  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <div className="relative h-48">
        <img 
          src={item.image} 
          alt={item.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute top-2 left-2">
          {getTypeIcon()}
        </div>
        {showTrending && item.trending && (
          <div className="absolute top-2 right-2">
            <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-200 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {item.trending}
            </Badge>
          </div>
        )}
        {isDiscovery && (
          <div className="absolute top-2 right-2">
            <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-200 flex items-center gap-1">
              <Compass className="h-3 w-3" />
              New Discovery
            </Badge>
          </div>
        )}
      </div>
      
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg line-clamp-1">{item.title}</CardTitle>
          {item.relevanceScore && (
            <Badge variant="secondary" className="ml-2">
              {item.relevanceScore}% match
            </Badge>
          )}
        </div>
        <CardDescription>{item.subtitle}</CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {item.tags.map((tag, index) => (
            <Badge key={index} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
        
        <div className="text-sm text-muted-foreground italic">
          "{item.reason}"
        </div>
        
        <div className="flex items-center text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 mr-1" />
          {item.location}
        </div>
      </CardContent>
      
      <CardFooter className="flex justify-between pt-1">
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <ThumbsUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Eye className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Bookmark className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Share2 className="h-4 w-4" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};
