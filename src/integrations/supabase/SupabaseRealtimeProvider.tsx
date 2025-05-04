import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from "@/types/database";
import { logEnvironmentVariables } from '@/utils/env-debug';

// Singleton variables to persist state across renders
let globalRealtimeChannel: RealtimeChannel | null = null;
let mountCount = 0;

// Realtime connection statuses
type ConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

// Define event types for type safety
type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE';

// Context interface
interface RealtimeContextType {
  status: ConnectionStatus;
  error: string | null;
  channel: RealtimeChannel | null;
  lastActivity: Date | null;
  lastEvent: { type: RealtimeEvent; payload: any } | null;
  reconnect: () => void;
}

// Create the context
const RealtimeContext = createContext<RealtimeContextType | null>(null);

// Hook for consuming the Realtime context
export const useRealtime = () => {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime must be used within a SupabaseRealtimeProvider');
  }
  return context;
};

/**
 * SupabaseRealtimeProvider component
 * A reliable WebSocket connection manager for Supabase Realtime
 */
export const SupabaseRealtimeProvider: React.FC<{
  children: React.ReactNode;
  debug?: boolean;
  channelName?: string;
}> = ({ children, debug = false, channelName = 'global-channel' }) => {
  // Component state
  const [status, setStatus] = useState<ConnectionStatus>('DISCONNECTED');
  const [error, setError] = useState<string | null>(null);
  const [lastActivity, setLastActivity] = useState<Date | null>(null);
  const [lastEvent, setLastEvent] = useState<{ type: RealtimeEvent; payload: any } | null>(null);
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);
  
  // Instance tracking
  const instanceIdRef = useRef<number>(++mountCount);
  const currentChannelRef = useRef<RealtimeChannel | null>(null);
  const isConnectingRef = useRef<boolean>(false);
  
  const log = (message: string, ...args: any[]) => {
    if (debug) {
      console.log(`[Realtime${instanceIdRef.current}] ${message}`, ...args);
    }
  };
  
  // Reconnect function (defined early to avoid reference issues)
  const reconnect = async () => {
    log('🔄 Manual reconnection requested');
    
    // Close existing channel if any
    if (currentChannelRef.current) {
      try {
        await currentChannelRef.current.unsubscribe();
        log('Unsubscribed from existing channel');
      } catch (err) {
        log('Error unsubscribing from channel:', err);
      }
      
      // Reset the global channel to force a new connection
      globalRealtimeChannel = null;
      currentChannelRef.current = null;
    }
    
    setStatus('DISCONNECTED');
    setError(null);
    
    // Re-initialize the connection
    const setupRealtimeChannel = async () => {
      try {
        setStatus('CONNECTING');
        log('Reconnecting to Supabase Realtime...');
        
        const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
        const supabaseKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
        
        log('Using URL:', supabaseUrl);
        log('Using key (first 10 chars):', supabaseKey.substring(0, 10) + '...');
        
        const client = createClient<Database>(
          supabaseUrl, 
          supabaseKey,
          {
            realtime: {
              params: {
                eventsPerSecond: 10
              }
            }
          }
        );
        
        // Create a channel with ALL required fields for postgres_changes
        const newChannel = client.channel(channelName, {
          config: {
            broadcast: { self: true },
            postgres_changes: [
              {
                event: 'INSERT',
                schema: 'public',
                table: '*'
              },
              {
                event: 'UPDATE',
                schema: 'public',
                table: '*'
              },
              {
                event: 'DELETE',
                schema: 'public',
                table: '*'
              }
            ]
          }
        });
        
        // Set up event handlers using the CORRECT format (3 arguments)
        newChannel
          .on('system', { event: '*' }, (payload) => {
            log('System event:', payload);
            setLastActivity(new Date());
          })
          .on('presence', { event: '*' }, (payload) => {
            log('Presence event:', payload);
            setLastActivity(new Date());
          })
          .on('broadcast', { event: '*' }, (payload) => {
            log('Broadcast event:', payload);
            setLastActivity(new Date());
          })
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: '*' }, (payload) => {
            log('Insert event:', payload);
            setLastEvent({ type: 'INSERT', payload });
            setLastActivity(new Date());
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: '*' }, (payload) => {
            log('Update event:', payload);
            setLastEvent({ type: 'UPDATE', payload });
            setLastActivity(new Date());
          })
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: '*' }, (payload) => {
            log('Delete event:', payload);
            setLastEvent({ type: 'DELETE', payload });
            setLastActivity(new Date());
          })
          .subscribe(async (status) => {
            log('Channel status on reconnect:', status);
            
            if (status === 'SUBSCRIBED') {
              log('✅ Reconnection SUCCESSFUL!');
              setStatus('CONNECTED');
              setError(null);
              setLastActivity(new Date());
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              log('❌ Reconnection failed');
              setStatus('ERROR');
              setError('Failed to reconnect to Supabase Realtime');
            }
          });
        
        globalRealtimeChannel = newChannel;
        currentChannelRef.current = newChannel;
        setChannel(newChannel);
        
      } catch (err) {
        log('❌ Error during reconnection:', err);
        setStatus('ERROR');
        setError(err instanceof Error ? err.message : 'Unknown error during reconnection');
      }
    };
    
    setupRealtimeChannel();
  };
  
  // Initialize and manage the Realtime connection
  useEffect(() => {
    log('Initializing Supabase Realtime connection...');
    
    // Avoid duplicate connections
    if (isConnectingRef.current) {
      log('Already connecting, skipping duplicate initialization');
      return;
    }
    
    isConnectingRef.current = true;
    
    const setupRealtimeChannel = async () => {
      try {
        setStatus('CONNECTING');
        
        // Debug environment variables
        logEnvironmentVariables();
        
        // Get environment variables for Supabase connection
        const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
        const supabaseKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || 
          // Fallback to the known working key for local development
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
        
        log('Using URL:', supabaseUrl);
        log('Using key (first 10 chars):', supabaseKey.substring(0, 10) + '...');
        
        // Create Supabase client if needed
        let client: SupabaseClient<Database>;
        try {
          // Try to use existing Supabase client from window if available
          client = (window as any).supabase || createClient<Database>(
            supabaseUrl,
            supabaseKey,
            {
              realtime: {
                params: {
                  eventsPerSecond: 10,
                }
              }
            }
          );
        } catch (err) {
          log('Error creating Supabase client, creating a new instance', err);
          client = createClient<Database>(
            supabaseUrl,
            supabaseKey
          );
        }
        
        // Use existing channel if available
        if (globalRealtimeChannel) {
          log('Using existing Realtime channel');
          currentChannelRef.current = globalRealtimeChannel;
          setChannel(globalRealtimeChannel);
          setStatus('CONNECTED'); 
          setLastActivity(new Date());
          return;
        }
        
        // Create a new channel with proper configuration
        log('Creating new Realtime channel:', channelName);
        const newChannel = client.channel(channelName, {
          config: {
            broadcast: { self: true },
            postgres_changes: [
              {
                event: 'INSERT',
                schema: 'public',
                table: '*'
              },
              {
                event: 'UPDATE', 
                schema: 'public',
                table: '*'
              },
              {
                event: 'DELETE',
                schema: 'public',
                table: '*'
              }
            ]
          }
        });
        
        // Set up event handlers using the CORRECT format (3 arguments)
        newChannel
          .on('system', { event: '*' }, (payload) => {
            log('System event:', payload);
            setLastActivity(new Date());
          })
          .on('presence', { event: '*' }, (payload) => {
            log('Presence event:', payload);
            setLastActivity(new Date());
          })
          .on('broadcast', { event: '*' }, (payload) => {
            log('Broadcast event:', payload);
            setLastActivity(new Date());
          })
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: '*' }, (payload) => {
            log('Insert event:', payload);
            setLastEvent({ type: 'INSERT', payload });
            setLastActivity(new Date());
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: '*' }, (payload) => {
            log('Update event:', payload);
            setLastEvent({ type: 'UPDATE', payload });
            setLastActivity(new Date());
          })
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: '*' }, (payload) => {
            log('Delete event:', payload);
            setLastEvent({ type: 'DELETE', payload });
            setLastActivity(new Date());
          })
          .subscribe(async (status) => {
            log('Channel status:', status);
            
            if (status === 'SUBSCRIBED') {
              log('✅ Connection SUCCESSFUL!');
              setStatus('CONNECTED');
              setError(null);
              setLastActivity(new Date());
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              log('❌ Connection failed or timed out');
              setStatus('ERROR');
              setError('Failed to connect to Supabase Realtime');
            }
          });
        
        // Store references to the channel
        globalRealtimeChannel = newChannel;
        currentChannelRef.current = newChannel;
        setChannel(newChannel);
        
      } catch (err) {
        log('❌ Error setting up Realtime connection:', err);
        setStatus('ERROR');
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        isConnectingRef.current = false;
      }
    };
    
    setupRealtimeChannel();
    
    // Cleanup function
    return () => {
      log('Cleaning up Realtime connection');
      // We don't unsubscribe here to maintain the connection for other components
      // The globalRealtimeChannel will be reused by the next instance
    };
  }, [debug, channelName]);
  
  // Provide context to children
  const contextValue: RealtimeContextType = {
    status,
    error,
    channel,
    lastActivity,
    lastEvent,
    reconnect
  };
  
  return (
    <RealtimeContext.Provider value={contextValue}>
      {children}
      {debug && (
        <div style={{ 
          position: 'fixed', 
          bottom: '20px', 
          right: '20px', 
          zIndex: 1000,
          padding: '12px', 
          borderRadius: '8px', 
          backgroundColor: status === 'CONNECTED' ? '#e6f7e6' : status === 'ERROR' ? '#ffebee' : '#f5f5f5',
          border: `1px solid ${status === 'CONNECTED' ? '#a5d6a7' : status === 'ERROR' ? '#ef9a9a' : '#e0e0e0'}`,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '12px',
          maxWidth: '300px'
        }}>
          <div style={{ 
            fontWeight: 'bold', 
            marginBottom: '4px', 
            color: status === 'CONNECTED' ? '#2e7d32' : status === 'ERROR' ? '#c62828' : '#424242' 
          }}>
            Realtime Status: {status}
          </div>
          {error && <div style={{ color: '#c62828', marginBottom: '4px' }}>{error}</div>}
          {lastActivity && (
            <div style={{ color: '#424242', fontSize: '11px' }}>
              Last activity: {lastActivity.toLocaleTimeString()}
            </div>
          )}
          {lastEvent && (
            <div style={{ color: '#0277bd', fontSize: '11px', marginTop: '4px' }}>
              Last event: {lastEvent.type} at {new Date().toLocaleTimeString()}
            </div>
          )}
          <button 
            onClick={reconnect}
            style={{
              marginTop: '8px',
              padding: '4px 8px',
              fontSize: '11px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#e0e0e0',
              cursor: 'pointer'
            }}
          >
            Force Reconnect
          </button>
        </div>
      )}
    </RealtimeContext.Provider>
  );
};
