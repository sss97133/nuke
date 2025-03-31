
import React, { useEffect, useContext, createContext, useState, useCallback, useRef } from 'react';
import { supabase } from './client';
import { useToast } from '@/hooks/use-toast';
import USE_MOCKS from '../utils/mock-enabler';

interface WebSocketContextValue {
  status: 'connected' | 'disconnected' | 'connecting';
  lastActivity: Date | null;
  reconnect: () => void;
}

const WebSocketContext = createContext<WebSocketContextValue>({
  status: 'connecting',
  lastActivity: null,
  reconnect: () => {}
});

export const useWebSocketStatus = () => useContext(WebSocketContext);

export const WebSocketManager: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Skip WebSocket connection if using mock data
  if (USE_MOCKS) {
    return (
      <WebSocketContext.Provider value={{
        status: 'connected', // Pretend we're connected when mocks are enabled
        lastActivity: new Date(),
        reconnect: () => {}
      }}>
        {children}
      </WebSocketContext.Provider>
    );
  }
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const [lastActivity, setLastActivity] = useState<Date | null>(null);
  const { toast } = useToast();
  
  const reconnect = useCallback(() => {
    console.log('Manually triggering WebSocket reconnection...');
    
    // Force a new connection by recreating the channel
    setupConnection();
    
    toast({
      title: "Reconnecting",
      description: "Attempting to reconnect to real-time services..."
    });
  }, [toast]);
  
  // Use useRef to store mutable values that won't cause rerenders
  const statusRef = useRef(status);
  const lastActivityRef = useRef(lastActivity);
  const channelRef = useRef<any>(null);
  
  // Update refs when state changes
  React.useEffect(() => {
    statusRef.current = status;
    lastActivityRef.current = lastActivity;
  }, [status, lastActivity]);
  
  const setupConnection = useCallback(() => {
    console.log('Setting up WebSocket connection...');
    try {
      // Check if we already have a channel and clean it up
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      
      const channel = supabase.channel('system');
      
      channel
        .on('broadcast', { event: 'system' }, (payload) => {
          const event = payload.payload;
          console.log(`WebSocket system event: ${event}`);
          
          if (event === 'connected') {
            setStatus('connected');
            setLastActivity(new Date());
            
            // Only show toast if previously disconnected
            if (statusRef.current === 'disconnected') {
              toast({
                title: "Connected",
                description: "Real-time connection established"
              });
            }
          } else if (event === 'disconnected') {
            setStatus('disconnected');
            
            toast({
              title: "Disconnected",
              description: "Real-time connection lost. Some features may be unavailable.",
              variant: "destructive"
            });
          }
        })
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            console.log('WebSocket manager subscription confirmed');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('WebSocket manager subscription error', err);
            setStatus('disconnected');
          }
        });
      // Setup heartbeat to detect stale connections
    const heartbeatInterval = setInterval(() => {
      // If we think we're connected but haven't had activity in 2 minutes,
      // try to reconnect
      if (
        statusRef.current === 'connected' && 
        lastActivityRef.current && 
        (new Date().getTime() - lastActivityRef.current.getTime() > 120000)
      ) {
        console.log('No recent WebSocket activity, reconnecting...');
        supabase.removeChannel(channel);
        // Don't call setupConnection directly to avoid infinite recursion
        // Instead use the reconnect function which will be stable
        reconnect();
      }
    }, 60000); // Check every minute
    
    // Store channel reference for cleanup
    channelRef.current = channel;
    
    return () => {
      clearInterval(heartbeatInterval);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  } catch (error) {
    console.error('Error setting up WebSocket connection:', error);
    setStatus('disconnected');
    toast({
      title: "Connection Error",
      description: "Failed to establish real-time connection",
      variant: "destructive"
    });
    
    // Return a no-op cleanup function
    return () => {};
  }
  }, [toast]); // Remove reconnect, status and lastActivity from dependencies
  
  // The reconnect function needs to be defined before setupConnection,
  // so we need to resolve this circular dependency
  const reconnectRef = useRef(reconnect);
  useEffect(() => {
    reconnectRef.current = reconnect;
  }, [reconnect]);
  
  // Only run the effect once when the component mounts
  useEffect(() => {
    const cleanup = setupConnection();
    
    // Setup listener for online/offline browser events
    const handleOnline = () => {
      console.log('Browser went online, reconnecting WebSocket...');
      reconnectRef.current();
    };
    
    const handleOffline = () => {
      console.log('Browser went offline');
      setStatus('disconnected');
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      cleanup();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []); // Empty dependency array - only run once
  
  const contextValue = {
    status,
    lastActivity,
    reconnect
  };
  
  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
};
