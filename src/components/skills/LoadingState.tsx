import React from 'react';
import { Gauge } from 'lucide-react';

export const LoadingState = () => {
  return (
    <div className="flex items-center justify-center p-8 text-foreground">
      <Gauge className="w-6 h-6 animate-spin mr-2" />
      <span className="animate-pulse">Loading developometer...</span>
    </div>
  );
};