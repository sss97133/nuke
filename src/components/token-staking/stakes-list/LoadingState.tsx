
import React from 'react';
import { Loader } from "lucide-react";

const LoadingState = () => {
  return (
    <div className="flex flex-col items-center justify-center p-8">
      <Loader className="h-8 w-8 animate-spin mb-4 text-primary" />
      <span className="text-muted-foreground">Loading your stakes...</span>
      <p className="text-xs text-muted-foreground mt-2">This will show your token stakes once loaded</p>
    </div>
  );
};

export default LoadingState;
