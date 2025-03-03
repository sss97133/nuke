
import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserRound, Users, Trophy, GitCommit, Car, BarChart2, Coins, Zap } from 'lucide-react';
import { SocialLinksForm } from '../SocialLinksForm';
import { StreamingLinksForm } from '../StreamingLinksForm';
import { TeamSection } from '../TeamSection';
import { AchievementsList } from '../AchievementsList';
import { UserDiscoveredVehicles } from '../UserDiscoveredVehicles';
import { UserDevelopmentSpectrum } from '../UserDevelopmentSpectrum';
import { UserActivityAnalytics } from '../UserActivityAnalytics';
import { UserInvestmentAnalytics } from '../UserInvestmentAnalytics';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { SocialLinks, StreamingLinks, Achievement } from '../types';

interface ProfileTabsProps {
  userId: string;
  socialLinks: SocialLinks;
  streamingLinks: StreamingLinks;
  achievements: Achievement[] | null;
  onSocialLinksChange: (links: SocialLinks) => void;
  onStreamingLinksChange: (links: StreamingLinks) => void;
  onSocialLinksSubmit: () => void;
  onStreamingLinksSubmit: () => void;
}

export const ProfileTabs = ({
  userId,
  socialLinks,
  streamingLinks,
  achievements,
  onSocialLinksChange,
  onStreamingLinksChange,
  onSocialLinksSubmit,
  onStreamingLinksSubmit
}: ProfileTabsProps) => {
  const { toast } = useToast();
  const [refreshingAnalytics, setRefreshingAnalytics] = useState(false);

  // Mock data for spectrum visualization
  const developmentCategories = [
    { name: 'Viewer', value: 35, color: '#3b82f6', percentile: 15 },
    { name: 'Owner', value: 25, color: '#10b981', percentile: 22 },
    { name: 'Technician', value: 20, color: '#f59e0b', percentile: 8 },
    { name: 'Investor', value: 20, color: '#8b5cf6', percentile: 30 },
  ];

  // Mock data for activity analytics
  const activityData = [
    { date: 'Jan', viewers: 20, owners: 15, technicians: 5, investors: 10 },
    { date: 'Feb', viewers: 25, owners: 18, technicians: 8, investors: 12 },
    { date: 'Mar', viewers: 30, owners: 20, technicians: 10, investors: 15 },
    { date: 'Apr', viewers: 35, owners: 22, technicians: 12, investors: 16 },
    { date: 'May', viewers: 40, owners: 25, technicians: 15, investors: 18 },
    { date: 'Jun', viewers: 45, owners: 30, technicians: 18, investors: 22 },
  ];

  // Mock data for investment analytics
  const investmentData = [
    { category: 'Classic Cars', value: 5000, roi: 12.5, color: '#3b82f6' },
    { category: 'Sports Cars', value: 7500, roi: 8.3, color: '#10b981' },
    { category: 'Luxury Sedans', value: 3000, roi: -2.1, color: '#f59e0b' },
    { category: 'Vintage', value: 4500, roi: 15.7, color: '#8b5cf6' },
    { category: 'Exotic', value: 10000, roi: 6.2, color: '#ec4899' },
  ];

  const handleRefreshAnalytics = () => {
    setRefreshingAnalytics(true);
    
    // Simulate data refresh
    setTimeout(() => {
      setRefreshingAnalytics(false);
      toast({
        title: "Analytics Refreshed",
        description: "Your profile analytics have been updated with the latest data.",
      });
    }, 1500);
  };

  // Calculate total investment and average ROI
  const totalInvested = investmentData.reduce((sum, item) => sum + item.value, 0);
  const averageROI = parseFloat((investmentData.reduce((sum, item) => sum + (item.value * item.roi), 0) / totalInvested).toFixed(1));

  return (
    <Tabs defaultValue="profile" className="w-full mt-6">
      <TabsList className="flex overflow-x-auto pb-px">
        <TabsTrigger value="profile" className="flex items-center gap-2">
          <UserRound className="w-4 h-4" />
          Profile
        </TabsTrigger>
        <TabsTrigger value="development" className="flex items-center gap-2">
          <Zap className="w-4 h-4" />
          Development
        </TabsTrigger>
        <TabsTrigger value="analytics" className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4" />
          Analytics
        </TabsTrigger>
        <TabsTrigger value="investments" className="flex items-center gap-2">
          <Coins className="w-4 h-4" />
          Investments
        </TabsTrigger>
        <TabsTrigger value="team" className="flex items-center gap-2">
          <Users className="w-4 h-4" />
          Team
        </TabsTrigger>
        <TabsTrigger value="achievements" className="flex items-center gap-2">
          <Trophy className="w-4 h-4" />
          Achievements
        </TabsTrigger>
        <TabsTrigger value="discoveries" className="flex items-center gap-2">
          <Car className="w-4 h-4" />
          Discoveries
        </TabsTrigger>
      </TabsList>

      <TabsContent value="profile" className="space-y-4 mt-4">
        <SocialLinksForm 
          socialLinks={socialLinks}
          onSocialLinksChange={onSocialLinksChange}
          onSubmit={onSocialLinksSubmit}
        />
        
        <StreamingLinksForm 
          streamingLinks={streamingLinks}
          onStreamingLinksChange={onStreamingLinksChange}
          onSubmit={onStreamingLinksSubmit}
        />
      </TabsContent>

      <TabsContent value="development" className="mt-4">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Your Development Spectrum</h2>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRefreshAnalytics}
              disabled={refreshingAnalytics}
            >
              {refreshingAnalytics ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Refreshing...
                </>
              ) : (
                'Refresh Analytics'
              )}
            </Button>
          </div>
          <p className="text-muted-foreground">
            This visualizes your activity across different aspects of the automotive community.
            The more you engage in each area, the more your spectrum grows in that direction.
          </p>
          
          <UserDevelopmentSpectrum 
            userId={userId}
            categories={developmentCategories}
          />
          
          <div className="pt-4 border-t">
            <h3 className="text-lg font-medium mb-2">Development Recommendations</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium flex items-center gap-2">
                  <Car className="h-4 w-4 text-primary" />
                  Become a Top Owner
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  Add more vehicles to your garage and complete their documentation to rise in the owner rankings.
                </p>
                <Button size="sm" variant="outline" className="mt-3 w-full">Explore Actions</Button>
              </div>
              
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium flex items-center gap-2">
                  <Coins className="h-4 w-4 text-primary" />
                  Grow Your Investment Portfolio
                </h4>
                <p className="text-sm text-muted-foreground mt-1">
                  Explore vehicle token staking opportunities to diversify your automotive investments.
                </p>
                <Button size="sm" variant="outline" className="mt-3 w-full">Explore Tokens</Button>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>
      
      <TabsContent value="analytics" className="mt-4">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Activity Analytics</h2>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRefreshAnalytics}
              disabled={refreshingAnalytics}
            >
              {refreshingAnalytics ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Refreshing...
                </>
              ) : (
                'Refresh Analytics'
              )}
            </Button>
          </div>
          <p className="text-muted-foreground">
            Track your activity progression and compare your engagement with platform averages.
          </p>
          
          <UserActivityAnalytics 
            userId={userId}
            activityData={activityData}
          />
        </div>
      </TabsContent>
      
      <TabsContent value="investments" className="mt-4">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Investment Analytics</h2>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleRefreshAnalytics}
              disabled={refreshingAnalytics}
            >
              {refreshingAnalytics ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Refreshing...
                </>
              ) : (
                'Refresh Analytics'
              )}
            </Button>
          </div>
          <p className="text-muted-foreground">
            Analyze your automotive investments and track returns across different categories.
          </p>
          
          <UserInvestmentAnalytics 
            userId={userId}
            investmentData={investmentData}
            totalInvested={totalInvested}
            averageROI={averageROI}
          />
        </div>
      </TabsContent>

      <TabsContent value="team" className="mt-4">
        <TeamSection />
      </TabsContent>

      <TabsContent value="achievements" className="mt-4">
        {achievements && achievements.length > 0 ? (
          <AchievementsList achievements={achievements} />
        ) : (
          <div className="text-center p-4 border rounded-lg">
            <Trophy className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground">No achievements yet</p>
          </div>
        )}
      </TabsContent>
      
      <TabsContent value="discoveries" className="mt-4">
        {userId && (
          <div className="grid gap-4">
            <p className="text-muted-foreground mb-2">
              All vehicles you have discovered across the web and added to our database.
            </p>
            <UserDiscoveredVehicles userId={userId} />
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
};
