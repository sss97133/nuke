import React from "react";
import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuctionGalleryProps {
  make: string;
  model: string;
  year: number;
  images?: string[];
}

export const AuctionGallery = ({ make, model, year, images }: AuctionGalleryProps) => {
  return (
    <div className="relative aspect-video bg-muted rounded-t-lg">
      {images && images.length > 0 ? (
        <img
          src={images[0]}
          alt={`${year} ${make} ${model}`}
          className="w-full h-full object-cover rounded-t-lg"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Camera className="w-12 h-12 text-muted-foreground/50" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      <div className="absolute bottom-4 left-4 right-4">
        <h2 className="text-2xl font-bold text-white">
          {year} {make} {model}
        </h2>
      </div>
    </div>
  );
};