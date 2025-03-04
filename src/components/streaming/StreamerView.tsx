
import React from 'react';
import { Card } from "@/components/ui/card";

export const StreamerView = () => {
  return (
    <Card className="bg-card">
      <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
        <p className="text-muted-foreground">Stream preview will appear here</p>
      </div>
      <div className="p-4 space-y-4">
        <div className="flex gap-2 justify-end">
          <StreamControls />
        </div>
      </div>
    </Card>
  );
};

const StreamControls = () => {
  return (
    <div className="flex gap-2">
      <button className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600">
        Start Streaming
      </button>
    </div>
  );
};
