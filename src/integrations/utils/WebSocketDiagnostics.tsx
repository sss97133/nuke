import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { getEnvValue } from '@/utils/env-utils';

interface WebSocketState {
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastPing?: Date;
  reconnectAttempts: number;
  error?: string;
}

const WebSocketDiagnostics: React.FC = () => {
  const [wsState, setWsState] = useState<WebSocketState>({ status: 'connecting', reconnectAttempts: 0 });
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (import.meta.env.DEV) {
      console.log('[WebSocketDiagnostics] Development mode: Not establishing diagnostic WebSocket.');
      setWsState({ status: 'disconnected', reconnectAttempts: 0, error: 'Diagnostics disabled in DEV' });
      return; 
    }
    
    if (!supabase) {
      console.error("Supabase client not available for WebSocket diagnostics.");
      setWsState({ status: 'error', error: 'Supabase client missing', reconnectAttempts: wsState.reconnectAttempts });
      return;
    }

    const supabaseUrl = getEnvValue('VITE_SUPABASE_URL');
    const supabaseAnonKey = getEnvValue('VITE_SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("Supabase URL or Key is not configured in env vars.");
        setWsState({ status: 'error', error: 'Supabase config missing', reconnectAttempts: wsState.reconnectAttempts });
        return;
    }
    
    const wsUrl = supabaseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/realtime/v1/websocket?apikey=' + supabaseAnonKey + '&vsn=1.0.0';

    console.log('Connecting diagnostic WebSocket...', wsUrl.substring(0, 30) + '...');
    setWsState(prev => ({ ...prev, status: 'connecting' }));

    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('Diagnostic WebSocket connected');
        setWsState({ status: 'connected', reconnectAttempts: 0, lastPing: new Date() });
        // Start heartbeat
        // ... (heartbeat logic)
      };

      wsRef.current.onmessage = (event) => {
        // ... (message handling)
        setWsState(prev => ({ ...prev, lastPing: new Date() }));
      };

      wsRef.current.onerror = (event) => {
        console.error('Diagnostic WebSocket error:', event);
        setWsState(prev => ({ ...prev, status: 'error', error: 'WebSocket error occurred' }));
        // attemptReconnect();
      };

      wsRef.current.onclose = (event) => {
        console.log('Diagnostic WebSocket disconnected:', event.code, event.reason);
        setWsState(prev => ({ ...prev, status: 'disconnected' }));
        // attemptReconnect();
      };

    } catch (error) {
        console.error("Failed to create diagnostic WebSocket:", error);
        setWsState({ status: 'error', error: 'Failed to create WebSocket', reconnectAttempts: wsState.reconnectAttempts });
        // attemptReconnect();
    }
    
  }, [toast, wsState.reconnectAttempts]);

  // ... rest of the component (useEffect, etc.) ...

  return (
    <div className="p-2 border rounded bg-card text-card-foreground text-xs">
      <p>WS Status: {wsState.status}</p>
      {wsState.error && <p className="text-red-500">Error: {wsState.error}</p>}
      {/* Add more diagnostic info if needed */}
    </div>
  );
};

export default WebSocketDiagnostics;
