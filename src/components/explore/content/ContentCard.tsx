
import React from 'react';
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Info, ThumbsUp, Share2, Bookmark, ExternalLink, User, Eye, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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
  created_at?: string;
  creator_id?: string;
  creator_name?: string;
  creator_avatar?: string;
  view_count?: number;
  like_count?: number;
  share_count?: number;
  save_count?: number;
  is_liked?: boolean;
  is_saved?: boolean;
}

interface ContentCardProps {
  item: ContentCardItem;
  showTrending?: boolean;
  onView?: (id: string, type: string) => void;
  onLike?: (id: string, type: string) => void;
  onShare?: (id: string, type: string) => void;
  onSave?: (id: string, type: string) => void;
}

export const ContentCard = ({ 
  item, 
  showTrending,
  onView,
  onLike,
  onShare,
  onSave 
}: ContentCardProps) => {
  const { 
    id, 
    title, 
    subtitle, 
    image, 
    tags, 
    location, 
    reason, 
    type, 
    trending,
    created_at,
    creator_id,
    creator_name,
    creator_avatar,
    view_count,
    like_count,
    share_count,
    save_count,
    is_liked,
    is_saved
  } = item;
  
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
      onView(id, type);
    }
  }, [id, type, onView]);

  // Format timestamp to relative time
  const getRelativeTime = (timestamp?: string) => {
    if (!timestamp) return '';
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    } catch (e) {
      return '';
    }
  };
  
  return (
    <Card className={`overflow-hidden ${getBgColor()} border-0 shadow-md`}>
      <div className="relative h-48 overflow-hidden">
        <img 
          src={image} 
          alt={title}
          className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
          onError={(e) => {
            // Use a placeholder image if the original image fails to load
            const target = e.target as HTMLImageElement;
            target.src = 'https://images.unsplash.com/photo-1550615306-a605768c7323?auto=format&fit=crop&w=600&q=80';
          }}
        />
        
        {/* Content type badge */}
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
        
        {/* View count badge */}
        {view_count && view_count > 0 && (
          <div className="absolute bottom-2 right-2">
            <Badge variant="outline" className="bg-black/60 text-white dark:bg-white/20 flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {view_count > 1000 ? `${(view_count / 1000).toFixed(1)}K` : view_count}
            </Badge>
          </div>
        )}
      </div>
      
      <CardHeader className="pb-2">
        {/* Creator info */}
        {creator_id && (
          <div className="flex items-center gap-2 mb-2">
            <Avatar className="h-6 w-6">
              <AvatarImage src={creator_avatar} />
              <AvatarFallback>{creator_name?.charAt(0) || 'U'}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium truncate">{creator_name || 'Unknown user'}</span>
            {created_at && (
              <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {getRelativeTime(created_at)}
              </span>
            )}
          </div>
        )}
        
        <h3 className="text-lg font-semibold leading-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </CardHeader>
      
      <CardContent className="space-y-3 pb-2">
        <div className="flex flex-wrap gap-1">
          {tags && tags.length > 0 ? tags.map((tag, index) => (
            <Badge key={index} variant="outline" className="text-xs">
              {tag}
            </Badge>
          )) : (
            <Badge variant="outline" className="text-xs">
              Automotive
            </Badge>
          )}
        </div>
        
        <div className="flex items-start gap-1">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
          <span className="text-sm">{location || "Unknown location"}</span>
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
            variant={is_liked ? "default" : "ghost"}
            size="sm" 
            className="flex-1 flex items-center gap-1"
            onClick={() => onLike && onLike(id, type)}
          >
            <ThumbsUp className="h-4 w-4" />
            {like_count && like_count > 0 && <span className="text-xs">{like_count}</span>}
          </Button>
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex-1 flex items-center gap-1"
            onClick={() => onShare && onShare(id, type)}
          >
            <Share2 className="h-4 w-4" />
            {share_count && share_count > 0 && <span className="text-xs">{share_count}</span>}
          </Button>
          
          <Button 
            variant={is_saved ? "default" : "ghost"}
            size="sm" 
            className="flex-1 flex items-center gap-1"
            onClick={() => onSave && onSave(id, type)}
          >
            <Bookmark className="h-4 w-4" />
            {save_count && save_count > 0 && <span className="text-xs">{save_count}</span>}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
