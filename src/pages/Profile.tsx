
import React, { useState, useEffect } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import UserProfile from "@/components/profile/UserProfile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, UserCheck } from 'lucide-react';
import { useOnboarding } from '@/hooks/useOnboarding';
import { Button } from '@/components/ui/button';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { Helmet } from 'react-helmet';

export const Profile = () => {
  const { userId } = useParams<{ userId: string }>();
  const { isCompleted, isLoading, currentStep, totalSteps } = useOnboarding();
  const navigate = useNavigate();
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const [loadingUsername, setLoadingUsername] = useState(true);

  useEffect(() => {
    const fetchUsername = async () => {
      if (!userId) return;
      
      try {
        setLoadingUsername(true);
        const { data, error } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', userId)
          .single();
          
        if (!error && data) {
          setProfileUsername(data.username);
        }
      } catch (error) {
        console.error('Error fetching username:', error);
      } finally {
        setLoadingUsername(false);
      }
    };
    
    fetchUsername();
  }, [userId]);

  // Default to 0 if currentStep is undefined
  const completionPercentage = Math.round(((currentStep || 0) / (totalSteps || 1)) * 100);

  // Dynamic page title based on whether viewing own or other's profile
  const pageTitle = profileUsername 
    ? `${profileUsername}'s Profile` 
    : 'Your Profile';

  return (
    <>
      <Helmet>
        <title>{pageTitle} | Garage Hub</title>
      </Helmet>
      
      <ScrollArea className="h-[calc(100vh-4rem)]">
        <div className="container mx-auto py-6 px-4 md:px-6 max-w-6xl">
          <div className="space-y-6">
            {!isLoading && !isCompleted && (
              <Card className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <AlertCircle className="h-5 w-5 text-yellow-600" />
                    Complete Your Profile
                  </CardTitle>
                  <CardDescription>
                    Your profile is {completionPercentage}% complete. Finish onboarding to unlock all features.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <Progress value={completionPercentage} className="h-2" />
                    
                    <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        Adding more information to your profile helps you connect with other vehicle enthusiasts
                        and builds your reputation in the community.
                      </p>
                      <Button 
                        onClick={() => navigate('/onboarding')} 
                        className="md:whitespace-nowrap"
                        size="sm"
                      >
                        Continue Onboarding
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {isCompleted && !userId && (
              <div className="mb-6 flex items-center gap-2 text-sm text-green-600 dark:text-green-500">
                <UserCheck className="h-4 w-4" />
                <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400">
                  Profile Complete
                </Badge>
              </div>
            )}
            
            <UserProfile />
          </div>
        </div>
      </ScrollArea>
    </>
  );
};

export default Profile;
