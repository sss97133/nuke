
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Award, Calendar, Clock, TrendingUp, CheckCircle, Star } from 'lucide-react';

interface AchievementProps {
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
  const achievements: AchievementProps[] = [
    {
      title: "First Service Completed",
      description: "Successfully completed your first vehicle service",
      earnedOn: "Apr 15, 2023",
      icon: <CheckCircle className="h-4 w-4" />,
      type: "common"
    },
    {
      title: "Master Diagnostician",
      description: "Diagnosed 50 complex vehicle issues accurately",
      earnedOn: "Jun 22, 2023",
      icon: <TrendingUp className="h-4 w-4" />,
      type: "rare"
    },
    {
      title: "Speed Demon",
      description: "Completed 10 services in record time",
      earnedOn: "Aug 05, 2023",
      icon: <Clock className="h-4 w-4" />,
      type: "rare"
    },
    {
      title: "Restoration Wizard",
      description: "Fully restored a classic vehicle to mint condition",
      earnedOn: "Oct 17, 2023",
      icon: <Star className="h-4 w-4" />,
      type: "epic"
    },
    {
      title: "Industry Legend",
      description: "Recognized by peers for outstanding contributions",
      earnedOn: "Jan 30, 2024",
      icon: <Award className="h-4 w-4" />,
      type: "legendary"
    }
  ];

  const achievementStats = {
    total: 27,
    common: 15,
    rare: 8,
    epic: 3,
    legendary: 1
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

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {achievements.map((achievement, index) => (
            <AchievementCard key={index} achievement={achievement} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
};

export default Achievements;
