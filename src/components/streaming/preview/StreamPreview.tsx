
import React from 'react';

interface StreamPreviewProps {
  isLive: boolean;
}

export const StreamPreview: React.FC<StreamPreviewProps> = ({ isLive }) => {
  return (
    <div className="aspect-video bg-muted rounded-lg flex flex-col items-center justify-center relative">
      <p className="text-muted-foreground">Stream preview will appear here</p>
      
      {isLive && (
        <div className="absolute top-4 left-4 bg-red-500 text-white text-xs px-2 py-1 rounded-full flex items-center">
          <span className="h-2 w-2 bg-white rounded-full mr-1 animate-pulse"></span>
          LIVE
        </div>
      )}
    </div>
  );
};
