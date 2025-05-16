import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase-client';
import { User } from '@supabase/supabase-js';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

interface UserAvatarProps {
  size?: 'sm' | 'md' | 'lg';
  onlyImage?: boolean;
}

const sizeMap = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14'
};

const UserAvatar: React.FC<UserAvatarProps> = ({ 
  size = 'md',
  onlyImage = false
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setUser(user);
        if (user?.user_metadata?.avatar_url) {
          setAvatarUrl(user.user_metadata.avatar_url);
        } else if (user?.email) {
          // Generate avatar URL from email using ui-avatars service
          const encodedEmail = encodeURIComponent(user.email);
          setAvatarUrl(`https://ui-avatars.com/api/?name=${encodedEmail}&background=0D8ABC&color=fff`);
        }
      } catch (error) {
        console.error('Error fetching user:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user?.user_metadata?.avatar_url) {
          setAvatarUrl(session.user.user_metadata.avatar_url);
        } else if (session?.user?.email) {
          const encodedEmail = encodeURIComponent(session.user.email);
          setAvatarUrl(`https://ui-avatars.com/api/?name=${encodedEmail}&background=0D8ABC&color=fff`);
        } else {
          setAvatarUrl(null);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <Avatar className={sizeMap[size]}>
        <AvatarFallback className="animate-pulse bg-gray-200" />
      </Avatar>
    );
  }

  if (!user && !onlyImage) {
    return (
      <div className="flex items-center space-x-2">
        <Avatar className={sizeMap[size]}>
          <AvatarFallback>?</AvatarFallback>
        </Avatar>
        {!onlyImage && <span className="text-sm text-gray-500">Not signed in</span>}
      </div>
    );
  }

  return (
    <div className={onlyImage ? '' : 'flex items-center space-x-2'}>
      <Avatar className={sizeMap[size]}>
        {avatarUrl ? (
          <AvatarImage src={avatarUrl} alt={user?.email || 'User'} />
        ) : (
          <AvatarFallback>
            {user?.email ? user.email.substring(0, 2).toUpperCase() : '?'}
          </AvatarFallback>
        )}
      </Avatar>
      {!onlyImage && user?.email && (
        <span className="text-sm">{user.email}</span>
      )}
    </div>
  );
};

export default UserAvatar;
