
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StreamChat } from '../StreamChat';
import { StreamViewParams } from '../services/types';

export const StreamViewer: React.FC = () => {
  const { username } = useParams<StreamViewParams>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [embedSrc, setEmbedSrc] = useState<string>('');

  useEffect(() => {
    if (!username) {
      setError("No stream username specified");
      return;
    }

    try {
      // Build the embed URL with proper parent parameter
      const hostname = window.location.hostname;
      const embedUrl = `https://player.twitch.tv/?channel=${username}&parent=${hostname}&muted=false`;
      console.log("Setting up Twitch viewer embed with URL:", embedUrl);
      setEmbedSrc(embedUrl);
    } catch (err) {
      console.error("Error setting up stream viewer:", err);
      setError("Failed to load stream");
    }
  }, [username]);

  return (
    <div className="container max-w-7xl mx-auto p-4 space-y-4">
      <Button 
        variant="outline" 
        className="mb-4" 
        onClick={() => navigate(-1)}
      >
        <ArrowLeft className="w-4 h-4 mr-2" /> Back
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Watching {username}'s Stream</CardTitle>
          <CardDescription>Live stream via Connected Crafters</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
            <div className="lg:col-span-2">
              <div className="aspect-video bg-muted relative overflow-hidden">
                {error ? (
                  <Alert variant="destructive" className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-3/4 z-20">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      {error}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <iframe
                    src={embedSrc}
                    height="100%"
                    width="100%"
                    className="absolute inset-0"
                    allowFullScreen={true}
                  ></iframe>
                )}
              </div>
            </div>
            <div className="p-4">
              <StreamChat streamId={username} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
