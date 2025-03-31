import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import USE_MOCKS from '../utils/mock-enabler';

interface WebSocketState {
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastPing?: Date;
  reconnectAttempts: number;
  error?: string;
}

export const WebSocketDiagnostics = () => {
  // Skip diagnostics if mocks are enabled
  if (USE_MOCKS) {
    return null;
  }
  
  const [wsState, setWsState] = useState<WebSocketState>({
    status: 'connecting',
    reconnectAttempts: 0
  });
  const { toast } = useToast();
  
  // Use refs to store mutable values that shouldn't trigger re-renders
  const channelRef = useRef<any>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  
  // Create a stable connect function with useCallback
  const connect = useCallback(() => {
    console.log('WebSocket: Attempting to connect...');
    setWsState(prev => ({ ...prev, status: 'connecting' }));
    
    try {
      // Clean up existing channel if it exists
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      
      const channel = supabase.channel('system_diagnostics');
      channelRef.current = channel;
      
      channel
        .on('broadcast', { event: 'system' }, (payload) => {
          const event = payload.payload;
          console.log(`WebSocket system event: ${event}`);
          
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
            if (pingIntervalRef.current) {
              clearInterval(pingIntervalRef.current);
              pingIntervalRef.current = null;
            }
            
            // Attempt reconnection
            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current);
            }
            
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectAttemptsRef.current += 1;
              setWsState(prev => ({ 
                ...prev, 
                reconnectAttempts: reconnectAttemptsRef.current
              }));
              
              if (channelRef.current) {
                channelRef.current.subscribe();
              }
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
            if (reconnectAttemptsRef.current > 2) {
              toast({
                title: "Connection Issues",
                description: "Having trouble maintaining a stable connection. Some real-time features may not work.",
                variant: "destructive"
              });
            }
          }
        });
        
      // Set up a ping to keep the connection alive
      pingIntervalRef.current = setInterval(() => {
        if (channelRef.current && channelRef.current.state === 'joined') {
          setWsState(prev => ({ ...prev, lastPing: new Date() }));
        }
      }, 30000); // Every 30 seconds
    } catch (error) {
      console.error('WebSocket setup error:', error);
      setWsState(prev => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }, [toast]);
  
  // Set up the initial connection and cleanup on unmount
  useEffect(() => {
    // Connect only once on mount
    connect();
    
    // Cleanup function to run on unmount
    return () => {
      console.log('WebSocket: Cleaning up connection');
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [connect]); // Only depend on the stable connect function
  
  return null; // This is a non-visual component
};

export default WebSocketDiagnostics;
