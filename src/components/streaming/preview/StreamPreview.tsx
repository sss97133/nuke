
import React, { useEffect, useState } from 'react';
import { twitchService } from '../services/TwitchService';
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface StreamPreviewProps {
  isLive: boolean;
}

export const StreamPreview: React.FC<StreamPreviewProps> = ({ isLive }) => {
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
          console.log("Fetched Twitch user data:", userData);
          
          if (userData) {
            setUsername(userData.login);
            
            // Build the embed URL with proper parent parameter
            const hostname = window.location.hostname;
            const embedUrl = `https://player.twitch.tv/?channel=${userData.login}&parent=${hostname}&muted=true`;
            console.log("Setting up Twitch embed with URL:", embedUrl);
            setEmbedSrc(embedUrl);
          } else {
            setError("Could not retrieve Twitch username");
          }
        } catch (error) {
          console.error("Error fetching Twitch user data:", error);
          setError(error instanceof Error ? error.message : "Failed to load Twitch data");
        } finally {
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
        setError("Not authenticated with Twitch");
      }
    };

    fetchUserData();
  }, [isLive]);

  // If we have the username and the stream is live, show the embedded player
  const showEmbeddedPlayer = isLive && username && !isLoading && !error;

  return (
    <div className="aspect-video bg-muted rounded-lg flex flex-col items-center justify-center relative">
      {error && (
        <Alert variant="destructive" className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-3/4 z-20">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {error}
          </AlertDescription>
        </Alert>
      )}
      
      {showEmbeddedPlayer ? (
        <>
          <iframe
            src={embedSrc}
            height="100%"
            width="100%"
            className="absolute inset-0"
            allowFullScreen={true}
          ></iframe>
          <div className="absolute bottom-4 right-4 text-xs text-white bg-black/50 px-2 py-1 rounded z-10">
            Channel: {username}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground">
          {isLoading ? "Loading stream preview..." : isLive ? "Stream preview is loading..." : "Stream preview will appear here"}
        </p>
      )}
      
      {isLive && (
        <div className="absolute top-4 left-4 bg-red-500 text-white text-xs px-2 py-1 rounded-full flex items-center z-10">
          <span className="h-2 w-2 bg-white rounded-full mr-1 animate-pulse"></span>
          LIVE
        </div>
      )}
    </div>
  );
};
