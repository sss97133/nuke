
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface StreamChatProps {
  streamId?: string;
}

export const StreamChat: React.FC<StreamChatProps> = ({ streamId }) => {
  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader>
        <CardTitle className="text-lg">Live Chat</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <ScrollArea className="flex-1">
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">
              {streamId ? `Chat for stream ${streamId}` : 'Chat messages will appear here'}
            </p>
          </div>
        </ScrollArea>
        <div className="mt-4">
          <input
            type="text"
            placeholder="Type a message..."
            className="w-full px-3 py-2 rounded-md border"
          />
        </div>
      </CardContent>
    </Card>
  );
};
