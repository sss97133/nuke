
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Check, Twitch } from 'lucide-react';
import twitchService from '../services/TwitchService';
import { Switch } from '@/components/ui/switch';

export const StreamSettings = () => {
  const [streamTitle, setStreamTitle] = useState('');
  const [category, setCategory] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const userData = twitchService.getUserData();
  const isAuthenticated = twitchService.isAuthenticated();
  
  const handleSaveSettings = async () => {
    try {
      setError(null);
      
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
            <Button className="bg-purple-700 hover:bg-purple-800">
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
