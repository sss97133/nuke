
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import UserProfile from "@/components/profile/UserProfile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from 'lucide-react';
import { useOnboarding } from '@/hooks/useOnboarding';
import { Button } from '@/components/ui/button';
import { BrowserRouter, useNavigate } from 'react-router-dom';

export const Profile = () => {
  const { isCompleted, isLoading } = useOnboarding();
  
  const ProfileWithRouter = () => {
    const navigate = useNavigate();
    
    return (
      <>
        {!isLoading && !isCompleted && (
          <Card className="mb-6 border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                Complete Your Profile
              </CardTitle>
              <CardDescription>
                Your profile is incomplete. Complete your profile to unlock all features.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Adding more information to your profile helps you connect with the automotive community
                and tracks your development across different areas of the platform.
              </p>
              <Button onClick={() => navigate('/onboarding')} className="whitespace-nowrap">
                Continue Onboarding
              </Button>
            </CardContent>
          </Card>
        )}
        
        <UserProfile />
      </>
    );
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container mx-auto py-6 px-4 md:px-6 max-w-6xl">
        <BrowserRouter>
          <ProfileWithRouter />
        </BrowserRouter>
      </div>
    </ScrollArea>
  );
};

export default Profile;
