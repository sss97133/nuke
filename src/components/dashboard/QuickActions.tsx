
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const QuickActions = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription>Common tasks and shortcuts</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {["Add new vehicle", "Schedule service", "View achievements", "Import data", "Team management"].map((action, i) => (
            <button 
              key={i} 
              className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-primary/10 transition-colors"
            >
              {action}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default QuickActions;
