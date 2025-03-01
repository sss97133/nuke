
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { UserMetrics } from "@/components/profile/UserMetrics";
import { AchievementsList } from "@/components/profile/AchievementsList";
import { UserDiscoveredVehicles } from "@/components/profile/UserDiscoveredVehicles";
import { TeamSection } from "@/components/profile/TeamSection";
import { SocialLinksForm } from "@/components/profile/SocialLinksForm";
import { StreamingLinksForm } from "@/components/profile/StreamingLinksForm";
import { ContributionsGraph } from "@/components/profile/ContributionsGraph";
import { Separator } from "@/components/ui/separator";

export interface ProfileTabsProps {
  profile: any;
  achievements: any[];
  activeTab: string;
}

export const ProfileTabs = ({ profile, achievements, activeTab }: ProfileTabsProps) => {
  return (
    <>
      {/* Profile Tab Content */}
      <TabsContent value="profile" className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
            </CardHeader>
            <CardContent>
              <UserMetrics profile={profile} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contributions</CardTitle>
            </CardHeader>
            <CardContent>
              <ContributionsGraph data={[]} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Social Links</CardTitle>
          </CardHeader>
          <CardContent>
            <SocialLinksForm 
              links={profile?.social_links} 
              userId={profile?.id} 
              readOnly={true} 
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Streaming Platforms</CardTitle>
          </CardHeader>
          <CardContent>
            <StreamingLinksForm 
              links={profile?.streaming_links} 
              userId={profile?.id} 
              readOnly={true} 
            />
          </CardContent>
        </Card>
      </TabsContent>

      {/* Achievements Tab Content */}
      <TabsContent value="achievements" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Achievements</CardTitle>
          </CardHeader>
          <CardContent>
            <AchievementsList achievements={achievements || []} />
          </CardContent>
        </Card>
      </TabsContent>

      {/* Discoveries Tab Content */}
      <TabsContent value="discoveries" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Discovered Vehicles</CardTitle>
          </CardHeader>
          <CardContent>
            <UserDiscoveredVehicles userId={profile?.id} />
          </CardContent>
        </Card>
      </TabsContent>

      {/* Team Tab Content */}
      <TabsContent value="team" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Team Members</CardTitle>
          </CardHeader>
          <CardContent>
            <TeamSection profileId={profile?.id} />
          </CardContent>
        </Card>
      </TabsContent>
    </>
  );
};
