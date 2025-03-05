
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface UserDevelopmentSpectrumProps {
  userId: string;
  categories: string[];
}

export const UserDevelopmentSpectrum: React.FC<UserDevelopmentSpectrumProps> = ({ 
  userId, 
  categories = ['knowledge', 'skills', 'experience'] 
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Development Spectrum</CardTitle>
      </CardHeader>
      <CardContent>
        <p>Development spectrum for user {userId} will be displayed here.</p>
        <ul>
          {categories.map(category => (
            <li key={category}>{category}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

export default UserDevelopmentSpectrum;
