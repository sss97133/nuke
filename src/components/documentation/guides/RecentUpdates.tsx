
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
            }
          ].map((update, index) => (
            <div key={index} className="border-l-2 border-primary pl-4">
              <div className="flex justify-between">
                <h3 className="font-medium">{update.version}</h3>
                <span className="text-sm text-muted-foreground">{update.date}</span>
              </div>
              <p className="text-sm text-muted-foreground">{update.description}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
