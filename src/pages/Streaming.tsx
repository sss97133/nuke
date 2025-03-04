import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StreamerView } from '@/components/streaming/StreamerView';
import { StreamChat } from '@/components/streaming/StreamChat';
import { StreamProvider } from '@/components/streaming/StreamProvider';
import twitchService from '@/components/streaming/services/TwitchService';

const Streaming = () => {
  const [streamId, setStreamId] = useState<string | undefined>(undefined);
  
  useEffect(() => {
    const fetchStreamId = async () => {
      if (twitchService.isAuthenticated()) {
        try {
          const userData = await twitchService.getCurrentUser();
          if (userData) {
            setStreamId(userData.login);
          }
        } catch (error) {
          console.error("Failed to fetch stream ID:", error);
        }
      }
    };
    
    fetchStreamId();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <ScrollArea className="h-[calc(100vh-4rem)]">
        <div className="container max-w-7xl mx-auto p-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Streaming Studio</CardTitle>
              <CardDescription>Manage your live streams and interact with your audience</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <StreamProvider>
                    <StreamerView />
                  </StreamProvider>
                </div>
                <div className="space-y-4">
                  <StreamChat streamId={streamId} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
};

export default Streaming;
