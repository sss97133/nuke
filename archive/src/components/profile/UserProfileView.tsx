import React from 'react';
import { useUserStore } from '@/stores/userStore';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, UserIcon, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * UserProfileView displays the current user's profile information
 * and provides logout functionality.
 */
export const UserProfileView: React.FC = () => {
  const { user, isLoading, signOut } = useUserStore();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  // Generate initials for avatar fallback
  const getInitials = (): string => {
    if (!user?.profile?.full_name) {
      return user?.email?.charAt(0).toUpperCase() || 'U';
    }

    return user.profile.full_name
      .split(' ')
      .map(name => name.charAt(0).toUpperCase())
      .join('')
      .substring(0, 2);
  };

  if (isLoading) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="pt-6 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle>Not Signed In</CardTitle>
          <CardDescription>You need to sign in to view your profile</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={() => navigate('/auth')} className="w-full">
            Sign In
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="flex flex-row items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarImage src={user.profile?.avatar_url || ''} alt={user.profile?.full_name || 'User'} />
          <AvatarFallback className="text-lg bg-primary text-primary-foreground">
            {getInitials()}
          </AvatarFallback>
        </Avatar>
        <div className="space-y-1">
          <CardTitle>{user.profile?.full_name || user.email}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">User ID</h3>
          <p className="text-sm text-muted-foreground break-all">{user.id}</p>
        </div>
        
        {user.profile?.username && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Username</h3>
            <p className="text-sm text-muted-foreground">{user.profile.username}</p>
          </div>
        )}
        
        {user.profile?.user_type && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">User Type</h3>
            <p className="text-sm text-muted-foreground capitalize">{user.profile.user_type}</p>
          </div>
        )}
        
        {user.profile?.bio && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Bio</h3>
            <p className="text-sm text-muted-foreground">{user.profile.bio}</p>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full" onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      </CardFooter>
    </Card>
  );
};

export default UserProfileView;
