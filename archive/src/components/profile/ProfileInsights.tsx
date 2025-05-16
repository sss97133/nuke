
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface ProfileInsightsProps {
  userId: string;
}

export const ProfileInsights = ({ userId }: ProfileInsightsProps) => {
  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="font-semibold mb-4">Profile Insights</h3>
        <p className="text-muted-foreground">
          This section will display insights about the user's profile and activity.
        </p>
      </CardContent>
    </Card>
  );
};

export default ProfileInsights;
