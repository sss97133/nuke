
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useStreamSettings } from './hooks/useStreamSettings';
import { ConnectedUser } from './components/ConnectedUser';
import { TwitchConnect } from './components/TwitchConnect';
import { ConfigError } from './components/ConfigError';
import { SettingsForm } from './components/SettingsForm';
import { ConfigInstructions } from './components/ConfigInstructions';

export const StreamSettings = () => {
  const {
    streamTitle,
    setStreamTitle,
    category,
    setCategory,
    isPublic,
    setIsPublic,
    error,
    configError,
    success,
    userData,
    handleSaveSettings,
    handleConnectTwitch,
    handleDisconnect,
    isAuthenticated,
    isConfigured
  } = useStreamSettings();
  
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
          <ConfigError errorMessage={configError} />
          <ConfigInstructions />
        </CardContent>
      </Card>
    );
  }
  
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
          <TwitchConnect onConnectTwitch={handleConnectTwitch} />
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
        <ConnectedUser 
          userData={userData} 
          onDisconnect={handleDisconnect} 
        />
        
        <SettingsForm
          streamTitle={streamTitle}
          onTitleChange={(e) => setStreamTitle(e.target.value)}
          category={category}
          onCategoryChange={(e) => setCategory(e.target.value)}
          isPublic={isPublic}
          onPublicChange={setIsPublic}
          onSave={handleSaveSettings}
          error={error}
          success={success}
        />
      </CardContent>
    </Card>
  );
};
