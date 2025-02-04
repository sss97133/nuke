import React from 'react';
import { Card } from '@/components/ui/card';
import { StreamChat } from './StreamChat';
import { TippingInterface } from './TippingInterface';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';

interface ViewerViewProps {
  streamId: string;
  streamerId: string;
  viewerCount: number;
}

export const ViewerView = ({ streamId, streamerId, viewerCount }: ViewerViewProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">Live Stream</h2>
            <Badge variant="outline" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              {viewerCount} watching
            </Badge>
          </div>
          <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
            Stream Content
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <StreamChat streamId={streamId} />
        <TippingInterface streamId={streamId} recipientId={streamerId} />
      </div>
    </div>
  );
};