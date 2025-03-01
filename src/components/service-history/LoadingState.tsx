
import React from 'react';
import { Wrench } from "lucide-react";

const LoadingState = () => {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-pulse flex flex-col items-center">
        <Wrench className="h-8 w-8 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Loading service history...</p>
      </div>
    </div>
  );
};

export default LoadingState;
