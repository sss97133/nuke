
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface MaintenanceStatProps {
  label: string;
  value: string;
  icon: React.ReactNode;
}

interface MaintenanceStatsCardProps {
  title: string;
  description: string;
  stats: MaintenanceStatProps[];
}

const MaintenanceStatsCard: React.FC<MaintenanceStatsCardProps> = ({ 
  title, 
  description, 
  stats 
}) => {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          {stats.map((stat, index) => (
            <div key={index} className="flex flex-col items-center justify-center p-3 border rounded-lg">
              <div className="mb-1">{stat.icon}</div>
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-xs text-muted-foreground text-center">{stat.label}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default MaintenanceStatsCard;
