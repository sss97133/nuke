
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StreamerView } from '@/components/streaming/StreamerView';
import { StreamChat } from '@/components/streaming/StreamChat';
import { StreamProvider } from '@/components/streaming/StreamProvider';
import twitchService from '@/components/streaming/services/TwitchService';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

const Streaming = () => {
  const [streamId, setStreamId] = useState<string | undefined>(undefined);
  const [configError, setConfigError] = useState<string | null>(null);
  
  useEffect(() => {
    // Check if Twitch client ID is configured
    if (!twitchService.isConfigured()) {
      setConfigError("Twitch Client ID is not configured. Please set VITE_TWITCH_CLIENT_ID in your environment variables.");
      return;
    }
    
    const fetchStreamId = async () => {
      if (twitchService.isAuthenticated()) {
        try {
          const userData = await twitchService.getCurrentUser();
          if (userData) {
            setStreamId(userData.login);
          }
        } catch (error) {
          console.error("Failed to fetch stream ID:", error);
          setConfigError("Error connecting to Twitch API. Please check your client ID.");
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
              {configError && (
                <Alert variant="destructive" className="mb-6">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    {configError}
                  </AlertDescription>
                </Alert>
              )}
              
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
