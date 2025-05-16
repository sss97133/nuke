
import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Clock } from 'lucide-react';
import { getRelativeTime } from '../utils/contentCardUtils';

interface ContentCardHeaderProps {
  title: string;
  subtitle: string;
  creator_id?: string;
  creator_name?: string;
  creator_avatar?: string;
  created_at?: string;
}

export const ContentCardHeader: React.FC<ContentCardHeaderProps> = ({
  title,
  subtitle,
  creator_id,
  creator_name,
  creator_avatar,
  created_at
}) => {
  return (
    <div className="pb-2 p-2 sm:p-3">
      {/* Creator info */}
      {creator_id && (
        <div className="flex items-center gap-1 sm:gap-2 mb-1 sm:mb-2">
          <Avatar className="h-5 w-5 sm:h-6 sm:w-6">
            <AvatarImage src={creator_avatar} />
            <AvatarFallback>{creator_name?.charAt(0) || 'U'}</AvatarFallback>
          </Avatar>
          <span className="text-xs sm:text-sm font-medium truncate">{creator_name || 'Unknown user'}</span>
          {created_at && (
            <span className="text-[10px] sm:text-xs text-muted-foreground ml-auto flex items-center gap-0.5 sm:gap-1">
              <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
              {getRelativeTime(created_at)}
            </span>
          )}
        </div>
      )}
      
      <h3 className="text-sm sm:text-lg font-semibold leading-tight">{title}</h3>
      <p className="text-xs sm:text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
};
