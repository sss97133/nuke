
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Twitch, AlertTriangle } from "lucide-react";
import { twitchService } from '../services/TwitchService';
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const StreamSettings = () => {
  const [streamTitle, setStreamTitle] = useState('My Stream');
  const [isTwitchConnected, setIsTwitchConnected] = useState(false);
  const [twitchUsername, setTwitchUsername] = useState('');
  const [hasClientIdError, setHasClientIdError] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Check if Twitch Client ID is missing
    setHasClientIdError(!import.meta.env.VITE_TWITCH_CLIENT_ID);
    
    // Check if we're already authenticated with Twitch
    const checkTwitchAuth = async () => {
      const isAuthenticated = twitchService.isAuthenticated();
      setIsTwitchConnected(isAuthenticated);
      
      if (isAuthenticated) {
        try {
          const userData = await twitchService.getCurrentUser();
          if (userData) {
            setTwitchUsername(userData.display_name || userData.login || '');
          }
        } catch (error) {
          console.error('Error fetching Twitch user data:', error);
        }
      }
    };
    
    checkTwitchAuth();
    
    // Listen for authentication state changes
    const handleAuthChange = async () => {
      const isAuthenticated = twitchService.isAuthenticated();
      setIsTwitchConnected(isAuthenticated);
      
      if (isAuthenticated) {
        try {
          const userData = await twitchService.getCurrentUser();
          if (userData) {
            setTwitchUsername(userData.display_name || userData.login || '');
          }
          
          toast({
            title: "Connected to Twitch",
            description: "Successfully connected to your Twitch account",
          });
        } catch (error) {
          console.error('Error fetching Twitch user data after auth change:', error);
        }
      }
    };
    
    window.addEventListener('twitch_auth_changed', handleAuthChange);
    
    // Clean up the event listener on unmount
    return () => {
      window.removeEventListener('twitch_auth_changed', handleAuthChange);
    };
  }, [toast]);

  const handleTwitchLogin = () => {
    try {
      if (hasClientIdError) {
        toast({
          title: "Twitch Configuration Error",
          description: "Twitch Client ID is missing. Please set VITE_TWITCH_CLIENT_ID in your environment variables.",
          variant: "destructive",
        });
        return;
      }
      
      twitchService.login();
      
      // Show toast about opening the login popup
      toast({
        title: "Twitch Login",
        description: "Opening Twitch login in a popup window. Please complete the authorization.",
      });
    } catch (error) {
      console.error('Error during Twitch login:', error);
      toast({
        title: "Twitch Login Error",
        description: error instanceof Error ? error.message : "There was an error connecting to Twitch. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleTwitchLogout = () => {
    twitchService.logout();
    setIsTwitchConnected(false);
    setTwitchUsername('');
    toast({
      title: "Disconnected from Twitch",
      description: "Your Twitch account has been disconnected",
    });
  };

  const updateStreamTitle = async () => {
    try {
      if (isTwitchConnected) {
        await twitchService.startStream(streamTitle);
        toast({
          title: "Stream title updated",
          description: "Your stream title has been updated on Twitch",
        });
      }
    } catch (error) {
      console.error('Error updating stream title:', error);
      toast({
        title: "Error updating title",
        description: error instanceof Error ? error.message : "There was an error updating your stream title",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Stream Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasClientIdError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Twitch Client ID is missing. Please set VITE_TWITCH_CLIENT_ID in your environment variables.
            </AlertDescription>
          </Alert>
        )}
        
        <div className="space-y-2">
          <Label htmlFor="title">Stream Title</Label>
          <div className="flex gap-2">
            <Input 
              id="title" 
              value={streamTitle} 
              onChange={(e) => setStreamTitle(e.target.value)} 
              placeholder="Enter your stream title"
            />
            <Button onClick={updateStreamTitle} disabled={!isTwitchConnected}>
              Update
            </Button>
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="quality">Quality</Label>
          <Select defaultValue="720p">
            <SelectTrigger id="quality">
              <SelectValue placeholder="Select quality" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1080p">1080p (High)</SelectItem>
              <SelectItem value="720p">720p (Medium)</SelectItem>
              <SelectItem value="480p">480p (Low)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label htmlFor="bitrate">Bitrate</Label>
            <span className="text-xs text-muted-foreground">3500 kbps</span>
          </div>
          <Slider 
            defaultValue={[3500]} 
            max={6000} 
            min={1000} 
            step={500}
            id="bitrate"
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="platform">Streaming Platform</Label>
          <Select defaultValue="twitch">
            <SelectTrigger id="platform">
              <SelectValue placeholder="Select platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="twitch">Twitch</SelectItem>
              <SelectItem value="youtube">YouTube</SelectItem>
              <SelectItem value="facebook">Facebook</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="pt-2">
          <Label className="mb-2 block">Twitch Integration</Label>
          {isTwitchConnected ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-green-500">
                <Twitch className="h-4 w-4" />
                <span>Connected to Twitch {twitchUsername ? `as ${twitchUsername}` : ''}</span>
              </div>
              <div className="text-xs text-muted-foreground mb-2">
                To stream, you'll need to use broadcasting software (like OBS Studio) connected to your Twitch account.
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleTwitchLogout}
              >
                Disconnect from Twitch
              </Button>
            </div>
          ) : (
            <>
              <Button 
                onClick={handleTwitchLogin}
                className="bg-[#9146FF] hover:bg-[#7d3bdd] text-white"
                disabled={hasClientIdError}
              >
                <Twitch className="mr-2 h-4 w-4" />
                Connect with Twitch
              </Button>
              <div className="text-xs text-muted-foreground mt-2">
                Connect to your Twitch account to manage your stream settings and go live.
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
