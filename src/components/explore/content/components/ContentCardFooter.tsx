
import React from 'react';
import { Button } from "@/components/ui/button";
import { ExternalLink, ThumbsUp, Share2, Bookmark } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ContentCardFooterProps {
  id: string;
  type: string;
  url?: string;
  like_count?: number;
  share_count?: number;
  save_count?: number;
  is_liked?: boolean;
  is_saved?: boolean;
  onLike?: (id: string, type: string) => void;
  onShare?: (id: string, type: string) => void;
  onSave?: (id: string, type: string) => void;
}

export const ContentCardFooter: React.FC<ContentCardFooterProps> = ({
  id,
  type,
  url,
  like_count,
  share_count,
  save_count,
  is_liked,
  is_saved,
  onLike,
  onShare,
  onSave
}) => {
  const isAppLink = url && url.startsWith('/');
  
  return (
    <div className="pt-0 flex flex-col gap-1 sm:gap-2 p-2 sm:p-3">
      {isAppLink ? (
        <Button variant="secondary" size="sm" className="w-full text-xs sm:text-sm py-1 sm:py-2" asChild>
          <Link to={url}>
            Watch Stream
            <ExternalLink className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      ) : (
        <Button variant="secondary" size="sm" className="w-full text-xs sm:text-sm py-1 sm:py-2">
          View Details
          <ExternalLink className="ml-1 h-3 w-3" />
        </Button>
      )}
      
      <div className="flex justify-between w-full">
        <Button 
          variant={is_liked ? "default" : "ghost"}
          size="sm" 
          className="flex-1 flex items-center gap-0.5 sm:gap-1 h-7 sm:h-8 text-xs"
          onClick={() => onLike && onLike(id, type)}
        >
          <ThumbsUp className="h-3 w-3 sm:h-4 sm:w-4" />
          {like_count && like_count > 0 && <span className="text-[10px] sm:text-xs">{like_count}</span>}
        </Button>
        
        <Button 
          variant="ghost" 
          size="sm" 
          className="flex-1 flex items-center gap-0.5 sm:gap-1 h-7 sm:h-8 text-xs"
          onClick={() => onShare && onShare(id, type)}
        >
          <Share2 className="h-3 w-3 sm:h-4 sm:w-4" />
          {share_count && share_count > 0 && <span className="text-[10px] sm:text-xs">{share_count}</span>}
        </Button>
        
        <Button 
          variant={is_saved ? "default" : "ghost"}
          size="sm" 
          className="flex-1 flex items-center gap-0.5 sm:gap-1 h-7 sm:h-8 text-xs"
          onClick={() => onSave && onSave(id, type)}
        >
          <Bookmark className="h-3 w-3 sm:h-4 sm:w-4" />
          {save_count && save_count > 0 && <span className="text-[10px] sm:text-xs">{save_count}</span>}
        </Button>
      </div>
    </div>
  );
};
