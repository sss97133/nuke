
import React, { useRef, useState } from 'react';
import { Pencil, Upload } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAvatarUpload } from './hooks/useAvatarUpload';
import { useBioUpdate } from './hooks/useBioUpdate';

interface UserProfileHeaderProps {
  userId: string;
  fullName: string | null;
  username: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
}

export const UserProfileHeader = ({ userId, fullName, username, avatarUrl, bio }: UserProfileHeaderProps) => {
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [bioText, setBioText] = useState(bio || '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { isUploading, uploadAvatar } = useAvatarUpload(userId, (url) => {
    // The URL update will be handled by the profile refetch
  });
  
  const { isUpdating, updateBio } = useBioUpdate(userId);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await uploadAvatar(file);
    }
  };

  const handleBioSave = async () => {
    await updateBio(bioText);
    setIsEditingBio(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="relative">
          <Avatar className="h-20 w-20">
            <AvatarImage src={avatarUrl || undefined} alt={fullName || 'User avatar'} />
            <AvatarFallback className="text-lg">
              {fullName ? fullName.charAt(0).toUpperCase() : 'U'}
            </AvatarFallback>
          </Avatar>
          
          <Button
            size="icon"
            variant="outline"
            className="absolute bottom-0 right-0 rounded-full"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            <Upload className="h-4 w-4" />
          </Button>
          
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={handleFileSelect}
          />
        </div>

        <div className="flex-1">
          <h2 className="text-xl font-semibold">{fullName || 'USER_NAME_NOT_FOUND'}</h2>
          <p className="text-sm text-muted-foreground">@{username || 'username_404'}</p>
          
          <div className="mt-4">
            {isEditingBio ? (
              <div className="space-y-2">
                <Textarea
                  value={bioText}
                  onChange={(e) => setBioText(e.target.value)}
                  placeholder="Write something about yourself..."
                  className="min-h-[80px]"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleBioSave}
                    disabled={isUpdating}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setBioText(bio || '');
                      setIsEditingBio(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="group relative">
                <p className="text-sm text-muted-foreground">
                  {bio || 'Add a bio to your profile'}
                </p>
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute -right-8 top-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setIsEditingBio(true)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
