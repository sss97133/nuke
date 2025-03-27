import React, { useEffect, useState } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Award, Calendar, Clock, TrendingUp, CheckCircle, Star } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Skeleton } from '@/components/ui/skeleton';

interface AchievementProps {
  id: string;
  title: string;
  description: string;
  earnedOn: string;
  icon: React.ReactNode;
  type: 'rare' | 'common' | 'epic' | 'legendary';
}

const AchievementCard = ({ achievement }: { achievement: AchievementProps }) => {
  const typeColors = {
    rare: "text-blue-500 bg-blue-500/10",
    common: "text-green-500 bg-green-500/10",
    epic: "text-purple-500 bg-purple-500/10",
    legendary: "text-amber-500 bg-amber-500/10"
  };

  return (
    <Card className="overflow-hidden">
      <div className={`h-2 ${typeColors[achievement.type].split(' ')[1]}`} />
      <CardHeader>
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-full ${typeColors[achievement.type]}`}>
              {achievement.icon}
            </div>
            <div>
              <CardTitle className="text-base">{achievement.title}</CardTitle>
              <CardDescription>{achievement.description}</CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="capitalize">
            {achievement.type}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center text-sm text-muted-foreground">
          <Calendar className="h-4 w-4 mr-1" />
          <span>Earned on {achievement.earnedOn}</span>
        </div>
      </CardContent>
    </Card>
  );
};

const Achievements = () => {
  const { session } = useAuth();
  const [achievements, setAchievements] = useState<AchievementProps[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAchievements = async () => {
      try {
        setIsLoading(true);
        setError(null);

        if (!session?.user?.id) {
          throw new Error('User not authenticated');
        }

        const { data, error: fetchError } = await supabase
          .from('achievements')
          .select('*')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false });

        if (fetchError) {
          throw fetchError;
        }

        // Transform the data to match our interface
        const transformedAchievements: AchievementProps[] = (data || []).map(achievement => ({
          id: achievement.id,
          title: achievement.title,
          description: achievement.description,
          earnedOn: new Date(achievement.created_at).toLocaleDateString(),
          icon: <Award className="h-4 w-4" />,
          type: achievement.category as 'rare' | 'common' | 'epic' | 'legendary'
        }));

        setAchievements(transformedAchievements);
      } catch (err) {
        console.error('Error fetching achievements:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch achievements');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAchievements();
  }, [session?.user?.id]);

  // Calculate achievement stats
  const achievementStats = {
    total: achievements.length,
    common: achievements.filter(a => a.type === 'common').length,
    rare: achievements.filter(a => a.type === 'rare').length,
    epic: achievements.filter(a => a.type === 'epic').length,
    legendary: achievements.filter(a => a.type === 'legendary').length
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container max-w-7xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Achievements</h1>
          <p className="text-muted-foreground">
            Track your professional milestones and accomplishments
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Total</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{achievementStats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-green-500">Common</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{achievementStats.common}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-blue-500">Rare</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{achievementStats.rare}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-purple-500">Epic</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{achievementStats.epic}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-amber-500">Legendary</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{achievementStats.legendary}</p>
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="h-2 w-full" />
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                    </div>
                    <Skeleton className="h-5 w-16" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : error ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center text-muted-foreground">
                <p>Failed to load achievements. Please try again later.</p>
              </div>
            </CardContent>
          </Card>
        ) : achievements.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center text-muted-foreground">
                <p>No achievements earned yet. Complete tasks and milestones to earn achievements!</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {achievements.map((achievement) => (
              <AchievementCard key={achievement.id} achievement={achievement} />
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
};

export default Achievements;
