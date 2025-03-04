
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
              version: "v1.1.0",
              date: "March 15, 2025",
              description: "Added image-based modification value assessment system"
            },
            {
              version: "v1.0.5",
              date: "February 28, 2025",
              description: "Enhanced marketplace listings with multi-camera documentation"
            },
            {
              version: "v1.0.4",
              date: "February 10, 2025",
              description: "Comprehensive documentation update with improved navigation"
            },
            {
              version: "v1.0.3",
              date: "January 25, 2025",
              description: "Added real-time auction tracking from multiple platforms"
            },
            {
              version: "v1.0.0",
              date: "January 10, 2025",
              description: "Initial release with core vehicle management features"
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
