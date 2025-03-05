
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface ProfileInsightsProps {
  userId: string;
}

export const ProfileInsights: React.FC<ProfileInsightsProps> = ({ userId }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile Insights</CardTitle>
      </CardHeader>
      <CardContent>
        <p>Insights for user {userId} will be displayed here.</p>
      </CardContent>
    </Card>
  );
};

export default ProfileInsights;
