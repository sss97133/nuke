import React from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface FormData {
  length: number;
  width: number;
  height: number;
}

export const StudioConfigForm = () => {
  const { register, handleSubmit } = useForm<FormData>();
  const { toast } = useToast();

  const onSubmit = async (data: FormData) => {
    try {
      const { error } = await supabase
        .from('studio_configurations')
        .insert({
          user_id: (await supabase.auth.getUser()).data.user?.id,
          name: 'Default Configuration',
          workspace_dimensions: {
            length: data.length,
            width: data.width,
            height: data.height
          }
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Studio configuration updated successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update studio configuration',
        variant: 'destructive',
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label htmlFor="length">Length (ft)</Label>
          <Input
            id="length"
            type="number"
            {...register('length', { required: true, min: 0 })}
            placeholder="30"
          />
        </div>
        <div>
          <Label htmlFor="width">Width (ft)</Label>
          <Input
            id="width"
            type="number"
            {...register('width', { required: true, min: 0 })}
            placeholder="20"
          />
        </div>
        <div>
          <Label htmlFor="height">Height (ft)</Label>
          <Input
            id="height"
            type="number"
            {...register('height', { required: true, min: 0 })}
            placeholder="16"
          />
        </div>
      </div>
      <Button type="submit">Save Configuration</Button>
    </form>
  );
};