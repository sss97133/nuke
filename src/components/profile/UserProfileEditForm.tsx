import type { Database } from '../types';
import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { UserRound, Camera, Loader2, Check, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAvatarUpload } from './hooks/useAvatarUpload';

interface UserProfileFormValues {
  username: string;
  fullName: string;
  bio: string;
}

interface UserProfileEditFormProps {
  userId: string;
  currentUsername: string;
  currentFullName: string;
  currentBio: string;
  currentAvatarUrl?: string;
  onProfileUpdated: () => void;
}

export const UserProfileEditForm = ({
  userId,
  currentUsername,
  currentFullName,
  currentBio,
  currentAvatarUrl,
  onProfileUpdated
}: UserProfileEditFormProps) => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(currentAvatarUrl || null);
  const [usernameAvailable, setUsernameAvailable] = useState(true);
  const [checkingUsername, setCheckingUsername] = useState(false);
  
  // Use the dedicated avatar upload hook
  const { isUploading, uploadAvatar } = useAvatarUpload(userId, (url) => {
    setAvatarPreview(url);
  });

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<UserProfileFormValues>({
    defaultValues: {
      username: currentUsername || '',
      fullName: currentFullName || '',
      bio: currentBio || ''
    }
  });

  const watchedUsername = watch('username');

  useEffect(() => {
    // Check username availability when username changes
    const checkUsernameAvailability = async (username: string) => {
      if (!username || username === currentUsername) {
        setUsernameAvailable(true);
        return;
      }

      setCheckingUsername(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('username')
          .eq('username', username)
          .not('id', 'eq', userId)
          .maybeSingle();

        setUsernameAvailable(!data);
      } catch (err) {
        console.error('Error checking username:', err);
      } finally {
        setCheckingUsername(false);
      }
    };

    // Debounce username check
    const debounceTimer = setTimeout(() => {
      if (watchedUsername && watchedUsername !== currentUsername) {
        checkUsernameAvailability(watchedUsername);
      }
    }, 500);

    return () => clearTimeout(debounceTimer);
  }, [watchedUsername, currentUsername, userId]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (file) {
      setAvatarFile(file);
      // Create a preview URL
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = async (data: UserProfileFormValues) => {
    if (!usernameAvailable) {
      toast({
        title: 'Username not available',
        description: 'Please choose a different username.',
        variant: 'destructive'
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Handle avatar upload if there's a new file
      let avatarUrl = currentAvatarUrl;
      if (avatarFile) {
        try {
          // Use the dedicated avatar upload hook
          await uploadAvatar(avatarFile);
          // The URL will be set via the callback in the hook initialization
        } catch (error) {
          console.error('Error uploading avatar:', error);
          // Continue with profile update even if avatar upload fails
        }
      }

      // Update profile data in Supabase
      const { error } = await supabase
        .from('profiles')
        .update({
          username: data.username,
          full_name: data.fullName,
          bio: data.bio,
        })
        .eq('id', userId);

      if (error) throw error;

      toast({
        title: 'Profile updated',
        description: 'Your profile information has been updated successfully.'
      });

      onProfileUpdated();
    } catch (error) {
      console.error('Error updating profile:', error);
      toast({
        title: 'Update failed',
        description: 'There was an error updating your profile. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="h-5 w-5" />
          Edit Profile Information
        </CardTitle>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          <div className="flex flex-col items-center mb-6">
            <div className="relative">
              <div className="h-24 w-24 rounded-full overflow-hidden border-2 border-primary/20 bg-muted flex items-center justify-center">
                {avatarPreview ? (
                  <img 
                    src={avatarPreview} 
                    alt="Avatar preview" 
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <UserRound className="h-12 w-12 text-muted-foreground" />
                )}
              </div>
              <label 
                htmlFor="avatar-upload" 
                className="absolute bottom-0 right-0 p-1 bg-primary rounded-full text-white cursor-pointer"
              >
                <Camera className="h-4 w-4" />
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handleFileChange}
                  disabled={isUploading}
                />
              </label>
            </div>
            {isUploading && (
              <div className="mt-2 flex items-center text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                Uploading...
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="username" className="flex items-center gap-2">
              Username
              {checkingUsername && <Loader2 className="h-3 w-3 animate-spin" />}
              {!checkingUsername && watchedUsername && watchedUsername !== currentUsername && (
                usernameAvailable ? 
                <Check className="h-4 w-4 text-green-500" /> : 
                <AlertCircle className="h-4 w-4 text-red-500" />
              )}
            </Label>
            <Input
              id="username"
              {...register('username', { required: true })}
              className={`${!usernameAvailable ? 'border-red-500' : ''}`}
            />
            {!usernameAvailable && (
              <p className="text-sm text-red-500">Username is already taken</p>
            )}
            {errors.username && (
              <p className="text-sm text-red-500">Username is required</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              {...register('fullName', { required: true })}
            />
            {errors.fullName && (
              <p className="text-sm text-red-500">Full name is required</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              {...register('bio')}
              rows={4}
              placeholder="Tell us a bit about yourself and your automotive interests..."
            />
          </div>
        </CardContent>

        <CardFooter className="flex justify-end">
          <Button 
            type="submit" 
            disabled={isSubmitting || isUploading || (!usernameAvailable && watchedUsername !== currentUsername)}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};
