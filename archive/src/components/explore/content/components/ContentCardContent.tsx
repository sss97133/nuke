
import React from 'react';
import { Badge } from "@/components/ui/badge";
import { MapPin, Info } from 'lucide-react';

interface ContentCardContentProps {
  tags: string[];
  location: string;
  reason: string;
}

export const ContentCardContent: React.FC<ContentCardContentProps> = ({
  tags,
  location,
  reason
}) => {
  return (
    <div className="space-y-2 sm:space-y-3 pb-1 sm:pb-2 p-2 sm:p-3">
      <div className="flex flex-wrap gap-1">
        {tags && tags.length > 0 ? tags.slice(0, 3).map((tag, index) => (
          <Badge key={index} variant="outline" className="text-[10px] sm:text-xs">
            {tag}
          </Badge>
        )) : (
          <Badge variant="outline" className="text-[10px] sm:text-xs">
            Automotive
          </Badge>
        )}
      </div>
      
      <div className="flex items-start gap-0.5 sm:gap-1">
        <MapPin className="h-3 w-3 sm:h-4 sm:w-4 shrink-0 text-muted-foreground mt-0.5" />
        <span className="text-xs sm:text-sm">{location || "Unknown location"}</span>
      </div>
      
      <div className="flex items-start gap-0.5 sm:gap-1">
        <Info className="h-3 w-3 sm:h-4 sm:w-4 shrink-0 text-muted-foreground mt-0.5" />
        <span className="text-[10px] sm:text-xs text-muted-foreground">{reason}</span>
      </div>
    </div>
  );
};
