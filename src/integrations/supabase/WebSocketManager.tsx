import React, { useEffect, useContext, createContext, useState, useCallback, useRef } from 'react';
import { supabase } from './client';
import { useToast } from '@/hooks/use-toast';
import { RealtimeChannel, RealtimeClient } from '@supabase/realtime-js';

// Define connection state strings based on documentation/usage
type ConnectionStatus = 'connecting' | 'open' | 'closing' | 'closed';

interface WebSocketContextValue {
  status: ConnectionStatus;
  lastActivity: Date | null;
  client: RealtimeClient | null;
  reconnect: () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | undefined>(undefined);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocket must be used within a WebSocketManager');
  }
  return context;
};

export const WebSocketManager: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<ConnectionStatus>('closed');
  const [lastActivity, setLastActivity] = useState<Date | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const clientRef = useRef<RealtimeClient | null>(null);
  const { toast } = useToast();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const statusUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const connectRealtimeClient = useCallback(() => {
    if (import.meta.env.DEV) {
      console.log("[WebSocketManager] Development mode detected, proceeding with connection attempt.");
    }

    if (!supabase) {
      console.error('[WebSocketManager] Supabase client not initialized. Cannot connect Realtime client.');
      setStatus('closed');
      return;
    }

    if (clientRef.current) {
      clientRef.current.disconnect();
    }

    console.log('Setting up Realtime client connection...');
    setStatus('connecting');
    setLastActivity(new Date());

    try {
      clientRef.current = supabase.realtime;
      if (!clientRef.current) {
        throw new Error('Supabase realtime client is not available.');
      }

      clientRef.current.connect();

      if (statusUpdateIntervalRef.current) clearInterval(statusUpdateIntervalRef.current);
      statusUpdateIntervalRef.current = setInterval(() => {
        if (clientRef.current) {
          // Cast the result of connectionState() to our defined type
          const currentState = clientRef.current.connectionState() as ConnectionStatus;
          setStatus(currentState);
            setLastActivity(new Date());
            
          if (currentState === 'open') {
            setReconnectAttempt(0);
          } else if (currentState === 'closed') {
            console.warn('[WebSocketManager] Realtime client detected CLOSED state.');
            attemptReconnect();
          }
        }
      }, 5000);

    } catch (error) {
      console.error('Failed to setup Realtime client connection:', error);
      setStatus('closed');
      toast({ title: 'Realtime Setup Failed', description: String(error), variant: 'destructive' });
      clientRef.current = null;
      attemptReconnect();
    }
  }, [toast]);

  const attemptReconnect = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (status === 'connecting' || status === 'open') return;

    const delay = Math.min(30000, (2 ** reconnectAttempt) * 1000);
    console.log(`Attempting Realtime client reconnection in ${delay / 1000}s (Attempt ${reconnectAttempt + 1})`);

    timerRef.current = setTimeout(() => {
      setReconnectAttempt(prev => prev + 1);
      connectRealtimeClient();
    }, delay);
  }, [reconnectAttempt, status, connectRealtimeClient]);

  useEffect(() => {
    connectRealtimeClient();
    
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (statusUpdateIntervalRef.current) clearInterval(statusUpdateIntervalRef.current);
      if (clientRef.current) {
        console.log('[WebSocketManager] Disconnecting Realtime client on unmount.');
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, [connectRealtimeClient]);

  const contextValue: WebSocketContextValue = {
    status,
    lastActivity,
    client: clientRef.current,
    reconnect: connectRealtimeClient,
  };
  
  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
};
