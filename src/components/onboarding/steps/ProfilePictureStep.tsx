
import type { Database } from '../types';
import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Camera, Upload } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ProfilePictureStepProps {
  avatarUrl: string;
  onUpdate: (url: string) => void;
}

export const ProfilePictureStep = ({ avatarUrl, onUpdate }: ProfilePictureStepProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;

      // Get user session to ensure they're authenticated
      const { data: { session } } = await supabase.auth.getSession();
  if (error) console.error("Database query error:", error);
      if (!session?.user) {
        throw new Error('User must be authenticated to upload avatar');
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${session.user.id}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
  if (error) console.error("Database query error:", error);
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        
        .getPublicUrl(filePath);

      // Update the profile with the new avatar URL
      const { error: updateError } = await supabase
  if (error) console.error("Database query error:", error);
        
        .update({ avatar_url: publicUrl })
        .eq('id', session.user.id);

      if (updateError) throw updateError;

      onUpdate(publicUrl);
      
      toast({
        title: "Success",
        description: "Profile picture updated successfully",
      });
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast({
        title: 'Error',
        description: 'Failed to upload image. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center space-y-4">
        {avatarUrl ? (
          <div className="relative w-32 h-32">
            <img
              src={avatarUrl}
              alt="Profile"
              className="w-full h-full rounded-full object-cover"
            />
            <Button
              size="icon"
              variant="outline"
              className="absolute bottom-0 right-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="lg"
            className="w-32 h-32 rounded-full"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-8 w-8" />
          </Button>
        )}
        
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/*"
          onChange={handleFileUpload}
        />
        
        <Label className="text-center text-muted-foreground">
          Upload a profile picture
        </Label>
      </div>
    </div>
  );
};
