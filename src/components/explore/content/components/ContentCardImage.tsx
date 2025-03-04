
import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Eye } from 'lucide-react';

interface ContentCardImageProps {
  image: string;
  type: string;
  trending?: string;
  showTrending?: boolean;
  view_count?: number;
}

export const ContentCardImage: React.FC<ContentCardImageProps> = ({
  image,
  type,
  trending,
  showTrending,
  view_count
}) => {
  return (
    <div className="relative h-32 sm:h-40 md:h-48 overflow-hidden">
      <img 
        src={image} 
        alt={type}
        className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
        onError={(e) => {
          // Use a placeholder image if the original image fails to load
          const target = e.target as HTMLImageElement;
          target.src = 'https://images.unsplash.com/photo-1550615306-a605768c7323?auto=format&fit=crop&w=600&q=80';
        }}
      />
      
      {/* Content type badge */}
      <div className="absolute top-2 left-2">
        <Badge variant="secondary" className="capitalize font-medium text-[10px] sm:text-xs">
          {type}
        </Badge>
      </div>
      
      {showTrending && trending && (
        <div className="absolute top-2 right-2">
          <Badge variant="outline" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 text-[10px] sm:text-xs">
            {trending}
          </Badge>
        </div>
      )}
      
      {/* View count badge */}
      {view_count && view_count > 0 && (
        <div className="absolute bottom-2 right-2">
          <Badge variant="outline" className="bg-black/60 text-white dark:bg-white/20 flex items-center gap-1 text-[10px] sm:text-xs">
            <Eye className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
            {view_count > 1000 ? `${(view_count / 1000).toFixed(1)}K` : view_count}
          </Badge>
        </div>
      )}
    </div>
  );
};
