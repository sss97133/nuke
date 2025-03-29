import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { UserRound, Camera, Loader2 } from 'lucide-react';
import { useProfileData } from '@/hooks/profile/useProfileData';
import { useAvatarUpload } from './hooks/useAvatarUpload';
import type { ProfileUpdate } from '@/types/profile';
import { useToast } from '@/hooks/use-toast';

interface UserProfileFormValues {
  username: string;
  full_name: string;
  bio: string;
  first_name?: string;
  last_name?: string;
}

interface UserProfileEditFormProps {
  onSuccess?: () => void;
}

export const UserProfileEditForm: React.FC<UserProfileEditFormProps> = ({ onSuccess }) => {
  const { profile, isLoading, updateProfile } = useProfileData();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { uploadAvatar } = useAvatarUpload(profile?.id || '', async (url) => {
    try {
      await updateProfile({ avatar_url: url });
      toast({
        title: 'Avatar Updated',
        description: 'Your profile picture has been successfully updated.'
      });
    } catch (error) {
      console.error('Error updating avatar:', error);
    }
  });

  const { register, handleSubmit, formState: { errors, isDirty }, reset } = useForm<UserProfileFormValues>({
    defaultValues: {
      username: profile?.username || '',
      full_name: profile?.full_name || '',
      bio: profile?.bio || '',
      first_name: profile?.first_name || '',
      last_name: profile?.last_name || ''
    }
  });

  // Update form values when profile changes
  useEffect(() => {
    if (profile) {
      reset({
        username: profile.username || '',
        full_name: profile.full_name || '',
        bio: profile.bio || '',
        first_name: profile.first_name || '',
        last_name: profile.last_name || ''
      });
    }
  }, [profile, reset]);

  const onSubmit = async (data: UserProfileFormValues) => {
    try {
      setIsSubmitting(true);
      
      // Validate username format
      if (!/^[a-zA-Z0-9_-]{3,20}$/.test(data.username)) {
        throw new Error('Username must be 3-20 characters and can only contain letters, numbers, underscores, and hyphens');
      }

      // Validate name fields
      if (data.first_name && data.first_name.length > 50) {
        throw new Error('First name must be less than 50 characters');
      }
      if (data.last_name && data.last_name.length > 50) {
        throw new Error('Last name must be less than 50 characters');
      }

      // Validate bio length
      if (data.bio && data.bio.length > 500) {
        throw new Error('Bio must be less than 500 characters');
      }

      // Convert form data to ProfileUpdate type
      const updateData: ProfileUpdate = {
        username: data.username,
        full_name: data.full_name,
        bio: data.bio,
        first_name: data.first_name,
        last_name: data.last_name
      };

      await updateProfile(updateData);
      onSuccess?.();
    } catch (error) {
      console.error('Error updating profile:', error);
      toast({
        title: 'Update Failed',
        description: error instanceof Error ? error.message : 'Failed to update profile. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="h-5 w-5" />
          Edit Profile
        </CardTitle>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              {...register('username', { 
                required: 'Username is required',
                pattern: {
                  value: /^[a-zA-Z0-9_-]{3,20}$/,
                  message: 'Username must be 3-20 characters and can only contain letters, numbers, underscores, and hyphens'
                }
              })}
            />
            {errors.username && (
              <p className="text-sm text-red-500">{errors.username.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="full_name">Full Name</Label>
            <Input
              id="full_name"
              {...register('full_name', { 
                required: 'Full name is required',
                maxLength: {
                  value: 100,
                  message: 'Full name must be less than 100 characters'
                }
              })}
            />
            {errors.full_name && (
              <p className="text-sm text-red-500">{errors.full_name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name</Label>
              <Input
                id="first_name"
                {...register('first_name', {
                  maxLength: {
                    value: 50,
                    message: 'First name must be less than 50 characters'
                  }
                })}
              />
              {errors.first_name && (
                <p className="text-sm text-red-500">{errors.first_name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name</Label>
              <Input
                id="last_name"
                {...register('last_name', {
                  maxLength: {
                    value: 50,
                    message: 'Last name must be less than 50 characters'
                  }
                })}
              />
              {errors.last_name && (
                <p className="text-sm text-red-500">{errors.last_name.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              {...register('bio', {
                maxLength: {
                  value: 500,
                  message: 'Bio must be less than 500 characters'
                }
              })}
            />
            {errors.bio && (
              <p className="text-sm text-red-500">{errors.bio.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Profile Picture</Label>
            <div className="flex items-center gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => document.getElementById('avatar-upload')?.click()}
              >
                <Camera className="h-4 w-4 mr-2" />
                Upload Photo
              </Button>
              <input
                id="avatar-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadAvatar(file);
                }}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button 
            type="submit" 
            disabled={isSubmitting || !isDirty}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
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
