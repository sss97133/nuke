
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, AlertTriangle, Check, Twitch } from 'lucide-react';
import twitchService from '../services/TwitchService';
import { Switch } from '@/components/ui/switch';
import { TwitchUserData } from '../services/types';

export const StreamSettings = () => {
  const [streamTitle, setStreamTitle] = useState('');
  const [category, setCategory] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [userData, setUserData] = useState<TwitchUserData | null>(null);
  
  useEffect(() => {
    // Check if Twitch client ID is configured
    if (!twitchService.isConfigured()) {
      setConfigError(`Twitch Client ID is missing. Please set VITE_TWITCH_CLIENT_ID in your environment variables.`);
    } else {
      setConfigError(null);
    }
    
    const fetchUserData = async () => {
      if (twitchService.isAuthenticated()) {
        try {
          const data = await twitchService.getCurrentUser();
          setUserData(data);
        } catch (err) {
          console.error("Failed to fetch user data:", err);
        }
      }
    };
    
    fetchUserData();
    
    // Listen for auth changes
    const handleAuthChange = () => {
      fetchUserData();
    };
    
    window.addEventListener('twitch_auth_changed', handleAuthChange);
    
    return () => {
      window.removeEventListener('twitch_auth_changed', handleAuthChange);
    };
  }, []);
  
  const handleSaveSettings = async () => {
    try {
      setError(null);
      
      if (!twitchService.isConfigured()) {
        setError('Twitch Client ID is not configured');
        return;
      }
      
      if (!streamTitle) {
        setError('Stream title is required');
        return;
      }
      
      // In a real app, here we would call Twitch API to update stream info
      console.log('Saving stream settings:', { streamTitle, category, isPublic });
      
      // Show success message
      setSuccess('Stream settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to save stream settings: ' + (err instanceof Error ? err.message : String(err)));
    }
  };
  
  const handleConnectTwitch = () => {
    try {
      twitchService.login();
    } catch (err) {
      setError('Failed to initiate Twitch login: ' + (err instanceof Error ? err.message : String(err)));
    }
  };
  
  const handleDisconnect = () => {
    twitchService.logout();
    setUserData(null);
  };
  
  // If there's a configuration error, show a different UI
  if (configError) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Stream Settings</CardTitle>
          <CardDescription>
            Twitch integration configuration
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{configError}</AlertDescription>
          </Alert>
          
          <div className="mt-4">
            <p className="text-sm text-muted-foreground mb-4">
              To use the streaming feature, you need to:
            </p>
            <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground mb-4">
              <li>Create a <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noopener noreferrer" className="text-primary underline">Twitch Developer Application</a></li>
              <li>Get your Client ID from the Developer Console</li>
              <li>Add it to your environment variables as VITE_TWITCH_CLIENT_ID</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  const isAuthenticated = twitchService.isAuthenticated();
  
  if (!isAuthenticated) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Stream Settings</CardTitle>
          <CardDescription>
            Connect your Twitch account to configure stream settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center p-4">
            <Button className="bg-purple-700 hover:bg-purple-800" onClick={handleConnectTwitch}>
              <Twitch className="mr-2 h-4 w-4" />
              Connect Twitch Account
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Stream Settings</CardTitle>
        <CardDescription>
          Configure your stream settings for Twitch
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {userData && (
          <div className="flex items-center gap-2 mb-4 text-sm">
            <Twitch className="h-4 w-4 text-purple-600" />
            <span>Connected as:</span>
            <span className="font-medium">{userData.displayName}</span>
            <Button 
              variant="outline" 
              size="sm" 
              className="ml-auto"
              onClick={handleDisconnect}
            >
              Disconnect
            </Button>
          </div>
        )}
        
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {success && (
          <Alert className="bg-green-50 border-green-200 text-green-800">
            <Check className="h-4 w-4" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}
        
        <div className="space-y-2">
          <Label htmlFor="streamTitle">Stream Title</Label>
          <Input 
            id="streamTitle" 
            value={streamTitle} 
            onChange={(e) => setStreamTitle(e.target.value)}
            placeholder="Enter a catchy title for your stream"
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="category">Category / Game</Label>
          <Input 
            id="category" 
            value={category} 
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Automotive, Just Chatting, etc."
          />
        </div>
        
        <div className="flex items-center space-x-2 pt-2">
          <Switch 
            id="isPublic" 
            checked={isPublic} 
            onCheckedChange={setIsPublic} 
          />
          <Label htmlFor="isPublic">Public Stream</Label>
        </div>
        
        <div className="pt-4">
          <Button onClick={handleSaveSettings}>
            Save Settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
