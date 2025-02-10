
import React, { useEffect } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { FeedItemIcon } from "./FeedItemIcon";
import { FeedItemProfile } from "@/types/feed";
import { useFeedInteractions } from "./useFeedInteractions";

interface FeedItemProps {
  id: string;
  content: string;
  itemType: string;
  createdAt: string;
  profile: FeedItemProfile | null;
  selected: boolean;
  onSelect: (id: string) => void;
  children?: React.ReactNode;
}

export const FeedItem = ({
  id,
  content,
  itemType,
  createdAt,
  profile,
  selected,
  onSelect,
  children
}: FeedItemProps) => {
  const { trackEngagement } = useFeedInteractions();
  const viewStartTime = React.useRef(Date.now());

  useEffect(() => {
    // Track view when component mounts
    trackEngagement(id, 'view');

    return () => {
      // Track view duration when component unmounts
      const viewDurationSeconds = Math.floor((Date.now() - viewStartTime.current) / 1000);
      trackEngagement(id, 'view_complete', viewDurationSeconds);
    };
  }, [id]);

  const handleClick = () => {
    trackEngagement(id, 'click');
    onSelect(id);
  };

  return (
    <div
      className={`p-4 border rounded-lg mb-4 cursor-pointer transition-colors ${
        selected ? 'bg-accent' : 'hover:bg-accent/50'
      }`}
      onClick={handleClick}
    >
      <div className="flex items-start space-x-4">
        <Avatar>
          <AvatarImage src={profile?.avatar_url || undefined} />
          <AvatarFallback>
            {profile?.username?.slice(0, 2).toUpperCase() || 'U'}
          </AvatarFallback>
        </Avatar>
        
        <div className="flex-1 space-y-1">
          <div className="flex items-center space-x-2">
            <span className="font-medium">
              {profile?.username || 'Anonymous'}
            </span>
            <FeedItemIcon itemType={itemType} />
          </div>
          
          <p className="text-sm text-muted-foreground">{content}</p>
          
          <div className="flex items-center space-x-2">
            <time className="text-xs text-muted-foreground">
              {new Date(createdAt).toLocaleDateString()}
            </time>
          </div>
          
          {children}
        </div>
      </div>
    </div>
  );
};
