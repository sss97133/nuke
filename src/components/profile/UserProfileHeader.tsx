import React, { useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Edit, UserRound } from 'lucide-react';
import { UserProfileEditForm } from './UserProfileEditForm';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface UserProfileHeaderProps {
  userId: string;
  fullName: string;
  username: string;
  avatarUrl?: string;
  bio?: string;
  isOwnProfile?: boolean;
}

export const UserProfileHeader = ({
  userId,
  fullName,
  username,
  avatarUrl,
  bio = '',
  isOwnProfile = false
}: UserProfileHeaderProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [profileData, setProfileData] = useState({
    fullName,
    username,
    avatarUrl,
    bio
  });
  const { toast } = useToast();

  const handleProfileUpdated = async () => {
    setIsEditing(false);
    
    // Refresh profile data
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, username, avatar_url, bio')
        .eq('id', userId)
        .single();
        
      if (error) throw error;
      
      if (data) {
        setProfileData({
          fullName: data.full_name || '',
          username: data.username || '',
          avatarUrl: data.avatar_url || undefined,
          bio: data.bio || ''
        });
        
        toast({
          title: "Profile updated",
          description: "Your profile information has been updated successfully."
        });
      }
    } catch (err) {
      console.error("Error refreshing profile data:", err);
    }
  };

  return (
    <Card className="bg-card border border-border shadow-sm">
      <CardContent className="p-6">
        {isEditing && isOwnProfile ? (
          <UserProfileEditForm
            userId={userId}
            currentUsername={profileData.username}
            currentFullName={profileData.fullName}
            currentBio={profileData.bio}
            currentAvatarUrl={profileData.avatarUrl}
            onProfileUpdated={handleProfileUpdated}
          />
        ) : (
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex flex-col items-center">
              <Avatar className="h-24 w-24 border-2 border-primary/10">
                {profileData.avatarUrl ? (
                  <AvatarImage
                    src={profileData.avatarUrl}
                    alt={profileData.fullName}
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback className="text-2xl bg-primary/5">
                  <UserRound className="h-12 w-12 text-muted-foreground" />
                </AvatarFallback>
              </Avatar>
            </div>
            
            <div className="flex-1 space-y-2 text-center md:text-left">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold">{profileData.fullName}</h2>
                <p className="text-muted-foreground">@{profileData.username}</p>
              </div>
              
              {profileData.bio && (
                <p className="text-sm md:text-base max-w-2xl">{profileData.bio}</p>
              )}
              
              {isOwnProfile && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-2"
                  onClick={() => setIsEditing(true)}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit Profile
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default UserProfileHeader;
