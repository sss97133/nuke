
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
  
  const setupConnection = useCallback(() => {
    const channel = supabase.channel('system');
    
    channel
      .on('system', (event) => {
        console.log(`WebSocket system event: ${event}`);
        
        if (event === 'connected') {
          setStatus('connected');
          setLastActivity(new Date());
          
          // Only show toast if previously disconnected
          if (status === 'disconnected') {
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
        status === 'connected' && 
        lastActivity && 
        (new Date().getTime() - lastActivity.getTime() > 120000)
      ) {
        console.log('No recent WebSocket activity, reconnecting...');
        supabase.removeChannel(channel);
        setupConnection();
      }
    }, 60000); // Check every minute
    
    return () => {
      clearInterval(heartbeatInterval);
      supabase.removeChannel(channel);
    };
  }, [status, lastActivity, toast]);
  
  useEffect(() => {
    const cleanup = setupConnection();
    
    // Setup listener for online/offline browser events
    const handleOnline = () => {
      console.log('Browser went online, reconnecting WebSocket...');
      reconnect();
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
  }, [setupConnection, reconnect]);
  
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
