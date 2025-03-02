
import React from 'react';
import { Loader2 } from 'lucide-react';

export const LoadingState: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center h-[400px] w-full">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="mt-4 text-muted-foreground">Loading skills data...</p>
    </div>
  );
};
