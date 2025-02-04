import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface StreamChatProps {
  streamId: string;
  isStreamer?: boolean;
}

interface ChatMessage {
  id: string;
  message: string;
  created_at: string;
  user_id: string;
  profiles?: {
    username: string | null;
    avatar_url: string | null;
  };
}

export const StreamChat = ({ streamId, isStreamer = false }: StreamChatProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    const fetchMessages = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data, error } = await supabase
        .from('stream_comments')
        .select(`
          id,
          message,
          created_at,
          user_id,
          profiles:user_id (
            username,
            avatar_url
          )
        `)
        .eq('stream_id', streamId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching messages:', error);
        return;
      }

      if (data) {
        setMessages(data as ChatMessage[]);
      }
    };

    fetchMessages();

    const channel = supabase
      .channel(`stream_chat:${streamId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'stream_comments',
          filter: `stream_id=eq.${streamId}`,
        },
        (payload) => {
          setMessages((current) => [...current, payload.new as ChatMessage]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [streamId]);

  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: 'Error',
          description: 'You must be logged in to send messages',
          variant: 'destructive',
        });
        return;
      }

      const { error } = await supabase.from('stream_comments').insert({
        stream_id: streamId,
        message: newMessage.trim(),
        user_id: user.id
      });

      if (error) throw error;

      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: 'Error',
        description: 'Failed to send message',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="flex flex-col h-[400px]">
      <div className="p-4 border-b">
        <h3 className="text-lg font-semibold">Live Chat</h3>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className="flex items-start gap-2">
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {msg.profiles?.username || 'Anonymous'}
                </p>
                <p className="text-sm text-muted-foreground">{msg.message}</p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          />
          <Button onClick={sendMessage}>Send</Button>
        </div>
      </div>
    </Card>
  );
};