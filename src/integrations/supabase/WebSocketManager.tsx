
import React, { useEffect, useContext, createContext, useState, useCallback } from 'react';
import { supabase } from './client';
import { useToast } from '@/hooks/use-toast';

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
  const statusRef = React.useRef(status);
  const lastActivityRef = React.useRef(lastActivity);
  
  // Update refs when state changes
  React.useEffect(() => {
    statusRef.current = status;
    lastActivityRef.current = lastActivity;
  }, [status, lastActivity]);
  
  const setupConnection = useCallback(() => {
    console.log('Setting up WebSocket connection...');
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
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('WebSocket manager subscription confirmed');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('WebSocket manager subscription error');
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
    
    return () => {
      clearInterval(heartbeatInterval);
      supabase.removeChannel(channel);
    };
  }, [toast, reconnect]); // Remove status and lastActivity from dependencies
  
  // The reconnect function needs to be defined before setupConnection,
  // so we need to resolve this circular dependency
  const reconnectRef = React.useRef(reconnect);
  React.useEffect(() => {
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
