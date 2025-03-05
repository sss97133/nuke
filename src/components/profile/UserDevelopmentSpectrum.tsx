
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

export interface UserDevelopmentSpectrumProps {
  userId: string;
  categories: string[];
}

export const UserDevelopmentSpectrum = ({ userId, categories }: UserDevelopmentSpectrumProps) => {
  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="font-semibold mb-4">Development Spectrum</h3>
        <p className="text-muted-foreground">
          This section will display the user's development spectrum across various categories.
        </p>
        <div className="mt-4">
          <p>Categories: {categories.join(', ')}</p>
        </div>
      </CardContent>
    </Card>
  );
};

export default UserDevelopmentSpectrum;
