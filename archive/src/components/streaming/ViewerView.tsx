
import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { StreamChat } from './StreamChat';

interface ViewerViewProps {
  streamId?: string;
}

export const ViewerView: React.FC<ViewerViewProps> = ({ streamId = "default-stream" }) => {
  return (
    <Card className="bg-card h-full">
      <div className="relative w-full h-96 bg-black rounded-t-md flex items-center justify-center">
        <div className="text-white text-center">
          <h3 className="text-xl font-medium">Live Stream</h3>
          <p className="text-muted-foreground">Waiting for stream to begin...</p>
        </div>
      </div>
      <CardContent className="p-4">
        <StreamChat streamId={streamId} />
      </CardContent>
    </Card>
  );
};
