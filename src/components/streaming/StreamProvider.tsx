import React, { createContext, useContext, useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface StreamContextType {
  isStreaming: boolean;
  viewerCount: number;
  startStream: () => Promise<void>;
  endStream: () => Promise<void>;
  streamId: string | null;
}

const StreamContext = createContext<StreamContextType | undefined>(undefined);

export const StreamProvider = ({ children }: { children: React.ReactNode }) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [streamId, setStreamId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (streamId) {
      const channel = supabase
        .channel(`stream:${streamId}`)
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState();
          setViewerCount(Object.keys(state).length);
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [streamId]);

  const startStream = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('live_streams')
        .insert({
          title: 'New Stream',
          status: 'live',
          started_at: new Date().toISOString(),
          user_id: user.id
        })
        .select()
        .single();

      if (error) throw error;

      setStreamId(data.id);
      setIsStreaming(true);
      toast({
        title: 'Stream Started',
        description: 'Your stream is now live!',
      });
    } catch (error) {
      console.error('Error starting stream:', error);
      toast({
        title: 'Error',
        description: 'Failed to start stream',
        variant: 'destructive',
      });
    }
  };

  const endStream = async () => {
    if (!streamId) return;

    try {
      const { error } = await supabase
        .from('live_streams')
        .update({
          status: 'ended',
          ended_at: new Date().toISOString(),
        })
        .eq('id', streamId);

      if (error) throw error;

      setStreamId(null);
      setIsStreaming(false);
      toast({
        title: 'Stream Ended',
        description: 'Your stream has ended',
      });
    } catch (error) {
      console.error('Error ending stream:', error);
      toast({
        title: 'Error',
        description: 'Failed to end stream',
        variant: 'destructive',
      });
    }
  };

  return (
    <StreamContext.Provider
      value={{
        isStreaming,
        viewerCount,
        startStream,
        endStream,
        streamId,
      }}
    >
      {children}
    </StreamContext.Provider>
  );
};

export const useStream = () => {
  const context = useContext(StreamContext);
  if (context === undefined) {
    throw new Error('useStream must be used within a StreamProvider');
  }
  return context;
};