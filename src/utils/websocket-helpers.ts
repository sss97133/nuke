
import { supabase } from '@/integrations/supabase/client';

/**
 * Helper function to test Supabase realtime connection
 * @returns Promise with connection status and message
 */
export const testRealtimeConnection = async (): Promise<{success: boolean; message: string}> => {
  return new Promise((resolve) => {
    // Create a temporary channel to test connection
    const channel = supabase
      .channel('connection_test')
      .subscribe((status) => {
        setTimeout(() => {
          // Clean up the test channel
          supabase.removeChannel(channel);
          
          if (status === 'SUBSCRIBED') {
            resolve({
              success: true,
              message: 'Successfully connected to Supabase realtime'
            });
          } else {
            resolve({
              success: false,
              message: `Failed to connect to Supabase realtime: ${status}`
            });
          }
        }, 1000);
      });
    
    // Set a timeout in case we never get a response
    setTimeout(() => {
      supabase.removeChannel(channel);
      resolve({
        success: false,
        message: 'Connection test timed out'
      });
    }, 5000);
  });
};

/**
 * Checks if the Supabase URL and anon key are valid
 * @returns boolean indicating if configuration appears valid
 */
export const validateSupabaseConfig = (): boolean => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  
  if (!url || url.length < 10) {
    console.error('Invalid Supabase URL configuration');
    return false;
  }
  
  if (!key || key.length < 10) {
    console.error('Invalid Supabase anon key configuration');
    return false;
  }
  
  return true;
};

/**
 * Helper to check if the connection issue is likely due to CORS
 */
export const checkForCorsIssues = (): boolean => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const currentHostname = window.location.hostname;
  
  // Check if connection is being made across origins
  if (url && !url.includes(currentHostname)) {
    // If not on localhost and trying to connect to a different domain
    if (currentHostname !== 'localhost' && 
        currentHostname !== '127.0.0.1' &&
        !currentHostname.includes('.lovable.dev')) {
      return true;
    }
  }
  
  return false;
};

/**
 * Create a robust channel subscription with automatic reconnection
 */
export const createRobustChannel = (
  channelName: string, 
  tables: Array<{
    table: string;
    schema?: string;
    event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
    filter?: string;
    callback: (payload: any) => void;
  }>,
  onStatusChange?: (status: 'connected' | 'disconnected' | 'connecting') => void
) => {
  let channel = supabase.channel(channelName);
  
  // Add all the table subscriptions
  tables.forEach(({ table, schema = 'public', event = '*', filter, callback }) => {
    channel = channel.on(
      'postgres_changes',
      {
        event,
        schema,
        table,
        filter
      },
      callback
    );
  });
  
  // Add system event handlers
  channel = channel
    .on('system', (event) => {
      if (event === 'connected') {
        console.log(`${channelName}: Connected`);
        onStatusChange?.('connected');
      } else if (event === 'disconnected') {
        console.error(`${channelName}: Disconnected`);
        onStatusChange?.('disconnected');
        
        // Attempt to reconnect after a delay
        setTimeout(() => {
          if (channel.state !== 'joined') {
            console.log(`${channelName}: Attempting to reconnect`);
            onStatusChange?.('connecting');
            channel.subscribe();
          }
        }, 5000);
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`${channelName}: Successfully subscribed`);
        onStatusChange?.('connected');
      } else if (status === 'CHANNEL_ERROR') {
        console.error(`${channelName}: Failed to subscribe`);
        onStatusChange?.('disconnected');
      }
    });
  
  return channel;
};

export const closeAllChannels = () => {
  // Get all active channels
  const channels = supabase.getChannels();
  
  // Remove each channel
  channels.forEach(channel => {
    supabase.removeChannel(channel);
  });
  
  console.log(`Closed ${channels.length} WebSocket channels`);
};
