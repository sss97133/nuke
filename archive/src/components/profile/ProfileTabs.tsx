
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
              <ContributionsGraph userId={profile?.id} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Social Links</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 bg-[#FFFFFF] p-2 border border-[#403E43]">
              <h3 className="text-sm font-bold mb-2">Social Media Links</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="text-xs mb-1">
                  <span className="font-bold">Twitter:</span> {profile?.social_links?.twitter || 'Not set'}
                </div>
                <div className="text-xs mb-1">
                  <span className="font-bold">Instagram:</span> {profile?.social_links?.instagram || 'Not set'}
                </div>
                <div className="text-xs mb-1">
                  <span className="font-bold">LinkedIn:</span> {profile?.social_links?.linkedin || 'Not set'}
                </div>
                <div className="text-xs mb-1">
                  <span className="font-bold">GitHub:</span> {profile?.social_links?.github || 'Not set'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Streaming Platforms</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-[#FFFFFF] p-2 border border-[#403E43]">
              <h3 className="text-sm font-bold mb-2">Streaming Platform Links</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="text-xs mb-1">
                  <span className="font-bold">Twitch:</span> {profile?.streaming_links?.twitch || 'Not set'}
                </div>
                <div className="text-xs mb-1">
                  <span className="font-bold">YouTube:</span> {profile?.streaming_links?.youtube || 'Not set'}
                </div>
                <div className="text-xs mb-1">
                  <span className="font-bold">TikTok:</span> {profile?.streaming_links?.tiktok || 'Not set'}
                </div>
              </div>
            </div>
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
            <TeamSection />
          </CardContent>
        </Card>
      </TabsContent>
    </>
  );
};
