
import React, { useEffect, useState } from 'react';
import { twitchService } from '../services/TwitchService';

interface StreamPreviewProps {
  isLive: boolean;
}

export const StreamPreview: React.FC<StreamPreviewProps> = ({ isLive }) => {
  const [username, setUsername] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Get the current user's Twitch username when authenticated
    const fetchUserData = async () => {
      if (twitchService.isAuthenticated()) {
        try {
          setIsLoading(true);
          const userData = await twitchService.getCurrentUser();
          if (userData) {
            setUsername(userData.login);
          }
        } catch (error) {
          console.error("Error fetching Twitch user data:", error);
        } finally {
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
      }
    };

    fetchUserData();
  }, [isLive]);

  // If we have the username and the stream is live, show the embedded player
  const showEmbeddedPlayer = isLive && username && !isLoading;

  return (
    <div className="aspect-video bg-muted rounded-lg flex flex-col items-center justify-center relative">
      {showEmbeddedPlayer ? (
        <iframe
          src={`https://player.twitch.tv/?channel=${username}&parent=${window.location.hostname}&muted=true`}
          height="100%"
          width="100%"
          className="absolute inset-0"
          allowFullScreen={true}
        ></iframe>
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
