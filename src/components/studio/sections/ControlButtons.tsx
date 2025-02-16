
import React from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface ControlButtonsProps {
  isRecording: boolean;
  isStreaming: boolean;
  onRecordingToggle: () => void;
  onStreamingToggle: () => void;
}

export const ControlButtons = ({
  isRecording,
  isStreaming,
  onRecordingToggle,
  onStreamingToggle,
}: ControlButtonsProps) => {
  const { toast } = useToast();

  const handleStreamToggle = async () => {
    try {
      if (!isStreaming) {
        const { data: streamSession, error: streamError } = await supabase
          .from('streaming_sessions')
          .insert([
            {
              title: 'New Stream',
              is_live: true
            }
          ])
          .select()
          .single();

        if (streamError) throw streamError;

        await supabase
          .from('user_sessions')
          .insert([
            {
              session_type: 'streaming',
              metadata: { streaming_session_id: streamSession.id }
            }
          ]);

        toast({
          title: "Stream Started",
          description: "Your stream is now live!"
        });
      } else {
        const { data: currentSession } = await supabase
          .from('streaming_sessions')
          .select()
          .eq('is_live', true)
          .limit(1)
          .single();

        if (currentSession) {
          await supabase
            .from('streaming_sessions')
            .update({
              is_live: false,
              ended_at: new Date().toISOString()
            })
            .eq('id', currentSession.id);
        }

        toast({
          title: "Stream Ended",
          description: "Your stream has been ended"
        });
      }

      onStreamingToggle();
    } catch (error) {
      console.error('Streaming error:', error);
      toast({
        title: "Error",
        description: "Failed to toggle streaming session",
        variant: "destructive"
      });
    }
  };

  const handleRecordingToggle = async () => {
    try {
      if (!isRecording) {
        await supabase
          .from('user_sessions')
          .insert([
            {
              session_type: 'recording',
              metadata: { started_at: new Date().toISOString() }
            }
          ]);

        toast({
          title: "Recording Started",
          description: "Your session is now being recorded"
        });
      } else {
        const { data: currentSession } = await supabase
          .from('user_sessions')
          .select()
          .eq('session_type', 'recording')
          .eq('is_active', true)
          .limit(1)
          .single();

        if (currentSession) {
          await supabase
            .from('user_sessions')
            .update({
              is_active: false,
              metadata: {
                ...currentSession.metadata,
                ended_at: new Date().toISOString()
              }
            })
            .eq('id', currentSession.id);
        }

        toast({
          title: "Recording Stopped",
          description: "Your recording has been saved"
        });
      }

      onRecordingToggle();
    } catch (error) {
      console.error('Recording error:', error);
      toast({
        title: "Error",
        description: "Failed to toggle recording session",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="flex gap-4 mb-6">
      <Button 
        variant={isRecording ? "destructive" : "default"}
        onClick={handleRecordingToggle}
        className="w-32"
      >
        {isRecording ? "Stop Recording" : "Start Recording"}
      </Button>
      <Button 
        variant={isStreaming ? "destructive" : "default"}
        onClick={handleStreamToggle}
        className="w-32"
      >
        {isStreaming ? "End Stream" : "Go Live"}
      </Button>
    </div>
  );
};
