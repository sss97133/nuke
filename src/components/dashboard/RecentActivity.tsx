
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity } from "lucide-react";

const RecentActivity = () => {
  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Your latest actions and updates</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {["Vehicle service completed", "New team member added", "Market value updated", "Certification earned"].map((activity, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <Activity className="h-4 w-4 text-primary" />
              <span>{activity}</span>
              <span className="ml-auto text-muted-foreground">{`${i + 1}d ago`}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default RecentActivity;
