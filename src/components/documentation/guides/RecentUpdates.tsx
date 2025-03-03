
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const RecentUpdates: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Updates</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {[
            {
              version: "v3.0.0",
              date: "June 2, 2024",
              description: "Major documentation update: comprehensive coverage of all system features"
            },
            {
              version: "v2.3.1",
              date: "May 15, 2024",
              description: "Added support for multi-camera studio recording"
            },
            {
              version: "v2.2.0",
              date: "April 22, 2024",
              description: "Enhanced inventory management system with AI suggestions"
            },
            {
              version: "v2.1.5",
              date: "March 10, 2024",
              description: "Bug fixes and performance improvements"
            },
            {
              version: "v2.1.0",
              date: "February 28, 2024",
              description: "Mobile optimization for all main application pages"
            }
          ].map((update, index) => (
            <div key={index} className="border-l-2 border-primary pl-4">
              <div className="flex flex-col sm:flex-row sm:justify-between">
                <h3 className="font-medium">{update.version}</h3>
                <span className="text-sm text-muted-foreground">{update.date}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">{update.description}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
