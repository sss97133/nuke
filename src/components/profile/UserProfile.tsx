import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { useParams } from 'react-router-dom';
import { ProfileContentContainer } from './components/ProfileContent';
import { supabase } from '@/integrations/supabase/client';

const UserProfile = () => {
  const { userId } = useParams<{ userId: string }>();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (session?.user) {
        setCurrentUserId(session.user.id);
      }
      setIsLoading(false);
    };
    
    getCurrentUser();
  }, []);

  if (isLoading) {
    return (
      <Card className="p-8 flex justify-center items-center">
        <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
      </Card>
    );
  }

  // Use the URL param if available, otherwise show current user's profile
  const profileUserId = userId || currentUserId;
  const isOwnProfile = profileUserId === currentUserId;
  
  if (!profileUserId) {
    return (
      <Card className="p-8">
        <p className="text-center text-muted-foreground">Please log in to view your profile.</p>
      </Card>
    );
  }

  return <ProfileContentContainer userId={profileUserId} isOwnProfile={isOwnProfile} />;
};

export default UserProfile;
