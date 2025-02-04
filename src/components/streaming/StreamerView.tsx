import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useStream } from './StreamProvider';
import { StreamChat } from './StreamChat';
import { Badge } from '@/components/ui/badge';
import { Users, Radio } from 'lucide-react';

export const StreamerView = () => {
  const { isStreaming, viewerCount, startStream, endStream, streamId } = useStream();

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">Stream Dashboard</h2>
            <Button
              onClick={isStreaming ? endStream : startStream}
              variant={isStreaming ? "destructive" : "default"}
            >
              {isStreaming ? 'End Stream' : 'Start Stream'}
            </Button>
          </div>
          
          {isStreaming && (
            <div className="flex items-center gap-4">
              <Badge variant="secondary" className="flex items-center gap-2">
                <Radio className="w-4 h-4" />
                Live
              </Badge>
              <Badge variant="outline" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                {viewerCount} viewers
              </Badge>
            </div>
          )}
        </Card>

        {isStreaming && streamId && (
          <Card className="p-4">
            <h3 className="text-lg font-semibold mb-4">Stream Preview</h3>
            <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
              Stream Preview
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        {streamId && <StreamChat streamId={streamId} isStreamer={true} />}
      </div>
    </div>
  );
};