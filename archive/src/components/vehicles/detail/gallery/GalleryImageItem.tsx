
import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { GalleryImage } from './types';

interface GalleryImageItemProps {
  image: GalleryImage;
  vehicleName: string;
}

export const GalleryImageItem: React.FC<GalleryImageItemProps> = ({ image, vehicleName }) => {
  return (
    <div className="aspect-video relative overflow-hidden rounded-md group">
      <img 
        src={image.url} 
        alt={`${vehicleName} ${image.type}`}
        className="w-full h-full object-cover hover:scale-105 transition-transform"
      />
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
        <div className="flex justify-between items-center">
          <Badge variant="secondary" className="text-xs">
            {image.type}
          </Badge>
          
          <div className="flex items-center gap-1">
            {image.isVerified && (
              <CheckCircle2 className="h-3 w-3 text-green-400" />
            )}
            <Avatar className="h-4 w-4">
              <AvatarImage src={image.user.avatar || undefined} />
              <AvatarFallback className="text-[8px]">{image.user.name?.charAt(0) || '?'}</AvatarFallback>
            </Avatar>
            <span className="text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity">
              {image.user.name}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
