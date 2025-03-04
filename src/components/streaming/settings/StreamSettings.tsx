
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Twitch } from "lucide-react";
import { twitchService } from '../services/TwitchService';
import { useToast } from "@/components/ui/use-toast";

export const StreamSettings = () => {
  const [streamTitle, setStreamTitle] = useState('My Stream');
  const [isTwitchConnected, setIsTwitchConnected] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Check if we're already authenticated with Twitch
    setIsTwitchConnected(twitchService.isAuthenticated());
    
    // Listen for authentication state changes
    const handleAuthChange = () => {
      setIsTwitchConnected(twitchService.isAuthenticated());
      
      if (twitchService.isAuthenticated()) {
        toast({
          title: "Connected to Twitch",
          description: "Successfully connected to your Twitch account",
        });
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
        description: "There was an error connecting to Twitch. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleTwitchLogout = () => {
    twitchService.logout();
    setIsTwitchConnected(false);
    toast({
      title: "Disconnected from Twitch",
      description: "Your Twitch account has been disconnected",
    });
  };

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Stream Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">Stream Title</Label>
          <Input 
            id="title" 
            value={streamTitle} 
            onChange={(e) => setStreamTitle(e.target.value)} 
            placeholder="Enter your stream title"
          />
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
          <Select defaultValue="platform1">
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
                <span>Connected to Twitch</span>
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
            <Button 
              onClick={handleTwitchLogin}
              className="bg-[#9146FF] hover:bg-[#7d3bdd] text-white"
            >
              <Twitch className="mr-2 h-4 w-4" />
              Connect with Twitch
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
