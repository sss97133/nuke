
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfileData } from "@/components/profile/hooks/useProfileData";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Edit, UserCircle, Trophy, Car, Users } from "lucide-react";
import { ProfileTabs } from "@/components/profile/ProfileTabs";

export const Profile = () => {
  const { profile, achievements, isLoading, error } = useProfileData();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("profile");

  if (error) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[calc(100vh-4rem)]">
        <Card className="w-full max-w-3xl">
          <CardContent className="p-6">
            <h2 className="text-2xl font-bold text-center text-red-500">Error Loading Profile</h2>
            <p className="text-center mt-4">
              {error instanceof Error ? error.message : "Failed to load profile data. Please try again."}
            </p>
            <div className="flex justify-center mt-6">
              <Button onClick={() => window.location.reload()}>Retry</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container mx-auto py-6 px-4 md:px-6 max-w-6xl">
        {isLoading ? <ProfileSkeleton /> : (
          <div className="space-y-6">
            {/* Profile Header */}
            <Card>
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-6 items-center md:items-start">
                  <div className="relative">
                    <Avatar className="w-24 h-24 border-4 border-background">
                      <AvatarImage src={profile?.avatar_url || ""} alt={profile?.username || "User"} />
                      <AvatarFallback className="text-2xl bg-primary text-primary-foreground">
                        {profile?.username?.charAt(0)?.toUpperCase() || profile?.full_name?.charAt(0)?.toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <Button 
                      size="icon" 
                      variant="outline" 
                      className="absolute -bottom-2 -right-2 rounded-full w-8 h-8"
                      onClick={() => navigate('/profile/edit')}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex-1 text-center md:text-left">
                    <h1 className="text-2xl font-bold">{profile?.full_name || "User"}</h1>
                    <p className="text-muted-foreground">@{profile?.username || "username"}</p>
                    <p className="mt-2 max-w-md">{profile?.bio || "No bio available"}</p>
                    
                    <div className="mt-4 flex flex-wrap gap-2 justify-center md:justify-start">
                      <div className="bg-secondary/20 px-3 py-1 rounded-full text-sm">
                        {profile?.user_type || "Viewer"}
                      </div>
                      <div className="bg-primary/20 px-3 py-1 rounded-full text-sm">
                        Reputation: {profile?.reputation_score || 0}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Profile Navigation */}
            <Tabs defaultValue={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="w-full justify-start mb-6 overflow-x-auto flex-nowrap">
                <TabsTrigger value="profile" className="flex items-center gap-2">
                  <UserCircle className="h-4 w-4" />
                  <span>Profile</span>
                </TabsTrigger>
                <TabsTrigger value="achievements" className="flex items-center gap-2">
                  <Trophy className="h-4 w-4" />
                  <span>Achievements</span>
                </TabsTrigger>
                <TabsTrigger value="discoveries" className="flex items-center gap-2">
                  <Car className="h-4 w-4" />
                  <span>Discoveries</span>
                </TabsTrigger>
                <TabsTrigger value="team" className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <span>Team</span>
                </TabsTrigger>
              </TabsList>

              <ProfileTabs 
                profile={profile} 
                achievements={achievements} 
                activeTab={activeTab} 
              />
            </Tabs>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};

const ProfileSkeleton = () => (
  <div className="space-y-6">
    <Card>
      <CardContent className="p-6">
        <div className="flex flex-col md:flex-row gap-6 items-center md:items-start">
          <Skeleton className="w-24 h-24 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-16 w-full max-w-md" />
            <div className="flex gap-2 mt-4">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
    
    <div className="space-y-4">
      <Skeleton className="h-10 w-full max-w-md" />
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
);

export default Profile;
