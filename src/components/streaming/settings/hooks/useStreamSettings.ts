
import { useState, useEffect } from 'react';
import twitchService from '../../services/TwitchService';
import { TwitchUserData } from '../../services/types';
import { useToast } from "@/components/ui/use-toast";

export const useStreamSettings = () => {
  const [streamTitle, setStreamTitle] = useState('');
  const [category, setCategory] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [userData, setUserData] = useState<TwitchUserData | null>(null);
  const { toast } = useToast();
  
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

  return {
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
    isAuthenticated: twitchService.isAuthenticated(),
    isConfigured: twitchService.isConfigured()
  };
};
