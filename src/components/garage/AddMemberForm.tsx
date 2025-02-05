import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type AddMemberFormProps = {
  garageId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
};

type ProfileResponse = {
  id: string;
};

export const AddMemberForm = ({ garageId, onSuccess, onCancel }: AddMemberFormProps) => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data: userData, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .single();

      if (userError) {
        throw new Error('User not found');
      }

      const { error: memberError } = await supabase
        .from('garage_members')
        .insert([
          { garage_id: garageId, user_id: (userData as ProfileResponse).id }
        ]);

      if (memberError) {
        throw memberError;
      }

      toast({
        title: 'Success',
        description: 'Member added successfully',
      });

      if (onSuccess) onSuccess();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add member',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email Address</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter member's email"
          required
        />
      </div>
      
      <div className="flex justify-end space-x-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Adding...' : 'Add Member'}
        </Button>
      </div>
    </form>
  );
};