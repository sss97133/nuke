import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface WebSocketState {
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastPing?: Date;
  reconnectAttempts: number;
  error?: string;
}

export const WebSocketDiagnostics = () => {
  const [wsState, setWsState] = useState<WebSocketState>({
    status: 'connecting',
    reconnectAttempts: 0
  });
  const { toast } = useToast();
  
  useEffect(() => {
    const channel = supabase.channel('system_diagnostics');
    let pingInterval: ReturnType<typeof setInterval>;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    
    const connect = () => {
      console.log('WebSocket: Attempting to connect...');
      setWsState(prev => ({ ...prev, status: 'connecting' }));
      
      channel
        .on('system', (event) => {
          if (event === 'connected') {
            console.log('WebSocket: Connected successfully');
            setWsState(prev => ({ 
              ...prev, 
              status: 'connected', 
              lastPing: new Date(), 
              error: undefined 
            }));
          } else if (event === 'disconnected') {
            console.log('WebSocket: Disconnected');
            setWsState(prev => ({ 
              ...prev, 
              status: 'disconnected' 
            }));
            
            // Clear ping interval when disconnected
            if (pingInterval) clearInterval(pingInterval);
            
            // Attempt reconnection
            reconnectTimeout = setTimeout(() => {
              setWsState(prev => ({ 
                ...prev, 
                reconnectAttempts: prev.reconnectAttempts + 1 
              }));
              channel.subscribe();
            }, 5000); // Try to reconnect after 5 seconds
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('WebSocket: Subscription confirmed');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('WebSocket: Subscription error');
            setWsState(prev => ({ 
              ...prev, 
              status: 'error',
              error: 'Failed to subscribe to channel'
            }));
            
            // Notify the user about connection issues
            if (wsState.reconnectAttempts > 2) {
              toast({
                title: "Connection Issues",
                description: "Having trouble maintaining a stable connection. Some real-time features may not work.",
                variant: "destructive"
              });
            }
          }
        });
        
      // Set up a ping to keep the connection alive
      pingInterval = setInterval(() => {
        if (channel.state === 'joined') {
          setWsState(prev => ({ ...prev, lastPing: new Date() }));
        }
      }, 30000); // Every 30 seconds
    };
    
    connect();
    
    return () => {
      console.log('WebSocket: Cleaning up connection');
      if (pingInterval) clearInterval(pingInterval);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      supabase.removeChannel(channel);
    };
  }, [toast]);
  
  return null; // This is a non-visual component
};

export default WebSocketDiagnostics;
