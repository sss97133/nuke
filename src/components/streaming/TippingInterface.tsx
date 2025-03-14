import type { Database } from '../types';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface TippingInterfaceProps {
  streamId: string;
  recipientId: string;
}

export const TippingInterface = ({ streamId, recipientId }: TippingInterfaceProps) => {
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleTip = async () => {
    if (!amount || isNaN(Number(amount))) {
      toast({
        title: 'Invalid Amount',
        description: 'Please enter a valid amount',
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
      if (!user) {
        toast({
          title: 'Error',
          description: 'You must be logged in to send tips',
          variant: 'destructive',
        });
        return;
      }

      const { error } = await supabase.from('stream_tips').insert({
  if (error) console.error("Database query error:", error);
        stream_id: streamId,
        recipient_id: recipientId,
        sender_id: user.id,
        amount: Number(amount),
        message: message.trim(),
      });

      if (error) throw error;

      toast({
        title: 'Tip Sent!',
        description: `Successfully sent $${amount} tip`,
      });

      setAmount('');
      setMessage('');
    } catch (error) {
      console.error('Error sending tip:', error);
      toast({
        title: 'Error',
        description: 'Failed to send tip',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="p-4 space-y-4 border rounded-lg">
      <h3 className="text-lg font-semibold">Send a Tip</h3>
      <div className="space-y-2">
        <Input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount ($)"
          min="1"
          step="1"
        />
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Add a message (optional)"
        />
        <Button
          onClick={handleTip}
          disabled={isProcessing || !amount}
          className="w-full"
        >
          {isProcessing ? 'Processing...' : 'Send Tip'}
        </Button>
      </div>
    </div>
  );
};