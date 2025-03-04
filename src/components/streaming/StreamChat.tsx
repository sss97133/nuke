
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { twitchService } from './services/TwitchService';

interface StreamChatProps {
  streamId?: string;
}

export const StreamChat: React.FC<StreamChatProps> = ({ streamId }) => {
  const [username, setUsername] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [embedSrc, setEmbedSrc] = useState<string>('');

  useEffect(() => {
    // Get the current user's Twitch username when authenticated
    const fetchUserData = async () => {
      if (twitchService.isAuthenticated()) {
        try {
          setIsLoading(true);
          setError(null); // Reset error state
          
          const userData = await twitchService.getCurrentUser();
          console.log("Fetched Twitch user data for chat:", userData);
          
          if (userData) {
            setUsername(userData.login);
            
            // Build the embed URL with proper parent parameter
            const hostname = window.location.hostname;
            const embedUrl = `https://www.twitch.tv/embed/${userData.login}/chat?parent=${hostname}`;
            console.log("Setting up Twitch chat embed with URL:", embedUrl);
            setEmbedSrc(embedUrl);
          } else {
            setError("Could not retrieve Twitch username");
          }
        } catch (error) {
          console.error("Error fetching Twitch user data for chat:", error);
          setError(error instanceof Error ? error.message : "Failed to load Twitch chat data");
        } finally {
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
        setError("Not authenticated with Twitch");
      }
    };

    fetchUserData();
  }, [streamId]);

  const showEmbeddedChat = username && !isLoading && !error;

  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader>
        <CardTitle className="text-lg">Live Chat</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {error}
            </AlertDescription>
          </Alert>
        )}
        
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground">Loading Twitch chat...</p>
          </div>
        ) : showEmbeddedChat ? (
          <iframe
            src={embedSrc}
            height="100%"
            width="100%"
            className="border-0 flex-1"
            frameBorder="0"
          ></iframe>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-4">
              <p className="text-muted-foreground text-center">
                {username ? "Chat messages will appear here when stream is live" : "Connect to Twitch to display chat"}
              </p>
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};
