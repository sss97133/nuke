
import React, { useEffect } from 'react';
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { ContentCardProps } from './types/ContentCardTypes';
import { ContentCardImage } from './components/ContentCardImage';
import { ContentCardHeader } from './components/ContentCardHeader';
import { ContentCardContent } from './components/ContentCardContent';
import { ContentCardFooter } from './components/ContentCardFooter';
import { getContentCardBackground } from './utils/contentCardUtils';

// Fix the export type error - using export type instead of export
export type { ContentCardItem } from './types/ContentCardTypes';
export type { ContentCardProps } from './types/ContentCardTypes';

export const ContentCard: React.FC<ContentCardProps> = ({ 
  item, 
  showTrending,
  onView,
  onLike,
  onShare,
  onSave 
}) => {
  const { 
    id, 
    title = 'Untitled Content', 
    subtitle = '', 
    image = '', 
    tags = [], 
    location = 'Unknown location', 
    reason = '', 
    type = 'post', 
    trending,
    created_at = new Date().toISOString(),
    creator_id,
    creator_name = 'Unknown creator',
    creator_avatar,
    view_count = 0,
    like_count = 0,
    share_count = 0,
    save_count = 0,
    is_liked = false,
    is_saved = false
  } = item || {};
  
  // Track view when card is rendered
  useEffect(() => {
    if (onView) {
      onView(id, type);
    }
  }, [id, type, onView]);
  
  // Safeguard against null/undefined item
  if (!item || !id) {
    return null;
  }
  
  return (
    <Card className={`overflow-hidden ${getContentCardBackground(type)} border-0 shadow-md`}>
      <ContentCardImage 
        image={image} 
        type={type} 
        trending={trending} 
        showTrending={showTrending} 
        view_count={view_count} 
      />
      
      <CardHeader className="p-0">
        <ContentCardHeader 
          title={title} 
          subtitle={subtitle} 
          creator_id={creator_id} 
          creator_name={creator_name} 
          creator_avatar={creator_avatar} 
          created_at={created_at} 
        />
      </CardHeader>
      
      <CardContent className="p-0">
        <ContentCardContent 
          tags={tags} 
          location={location} 
          reason={reason} 
        />
      </CardContent>
      
      <CardFooter className="p-0">
        <ContentCardFooter 
          id={id} 
          type={type} 
          like_count={like_count} 
          share_count={share_count} 
          save_count={save_count} 
          is_liked={is_liked} 
          is_saved={is_saved} 
          onLike={onLike} 
          onShare={onShare} 
          onSave={onSave} 
        />
      </CardFooter>
    </Card>
  );
};
