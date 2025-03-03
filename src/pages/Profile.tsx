
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import UserProfile from "@/components/profile/UserProfile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from 'lucide-react';

export const Profile = () => {
  // In a real implementation, you'd check if the user has completed onboarding
  const isOnboardingComplete = true; // Simulated check

  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container mx-auto py-6 px-4 md:px-6 max-w-6xl">
        {!isOnboardingComplete && (
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
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Adding more information to your profile helps you connect with the automotive community
                and tracks your development across different areas of the platform.
              </p>
            </CardContent>
          </Card>
        )}
        
        <UserProfile />
      </div>
    </ScrollArea>
  );
};

export default Profile;
