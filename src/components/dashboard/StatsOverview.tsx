
import React from 'react';
import { Car, Wrench, Users, TrendingUp } from "lucide-react";
import StatCard from './StatCard';

const StatsOverview = () => {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Total Vehicles"
        value="12"
        description="2 added this month"
        icon={Car}
      />
      <StatCard
        title="Active Services"
        value="4"
        description="1 pending completion"
        icon={Wrench}
      />
      <StatCard
        title="Team Members"
        value="8"
        description="3 online now"
        icon={Users}
      />
      <StatCard
        title="Market Value"
        value="$143,250"
        description="↑2.1% from last month"
        icon={TrendingUp}
      />
    </div>
  );
};

export default StatsOverview;
