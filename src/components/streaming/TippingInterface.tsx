import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

interface TippingInterfaceProps {
  streamId: string;
  recipientId: string;
  onTipComplete?: () => void;
}

export const TippingInterface: React.FC<TippingInterfaceProps> = ({
  streamId,
  recipientId,
  onTipComplete
}) => {
  const [amount, setAmount] = useState<number>(5);
  const [message, setMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleTip = async () => {
    if (!amount || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid tip amount",
        variant: "destructive"
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: session } = await supabase.auth.getSession();
      
      if (!session.session?.user) {
        toast({
          title: "Authentication Required",
          description: "Please login to send tips",
          variant: "destructive"
        });
        return;
      }
      
      const senderId = session.session.user.id;
      
      const { error } = await supabase
        .from('stream_tips')
        .insert({
          stream_id: streamId,
          sender_id: senderId,
          recipient_id: recipientId,
          amount: amount,
          message: message || null
        });
      
      if (error) {
        console.error("Database query error:", error);
        throw new Error(error.message);
      }
      
      toast({
        title: "Tip Sent!",
        description: `You sent a $${amount} tip`
      });
      
      // Reset form
      setAmount(5);
      setMessage('');
      
      // Notify parent component
      if (onTipComplete) {
        onTipComplete();
      }
      
    } catch (error) {
      console.error('Error sending tip:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send tip",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 p-4 border rounded-md bg-card">
      <h3 className="text-lg font-semibold">Send a Tip</h3>
      
      <div>
        <Label htmlFor="amount">Amount ($)</Label>
        <div className="flex space-x-2 mt-1">
          {[1, 5, 10, 20].map((value) => (
            <Button
              key={value}
              type="button"
              variant={amount === value ? "default" : "outline"}
              onClick={() => setAmount(value)}
              size="sm"
              className="flex-1"
            >
              ${value}
            </Button>
          ))}
        </div>
        <div className="mt-2">
          <Input
            id="custom-amount"
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
            className="w-full"
          />
        </div>
      </div>
      
      <div>
        <Label htmlFor="message">Message (Optional)</Label>
        <Input
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Add a message with your tip"
          className="w-full mt-1"
          maxLength={100}
        />
      </div>
      
      <Button 
        className="w-full" 
        onClick={handleTip}
        disabled={isSubmitting}
      >
        {isSubmitting ? 'Processing...' : `Tip $${amount}`}
      </Button>
    </div>
  );
};

export default TippingInterface;