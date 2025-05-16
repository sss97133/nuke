
import React from 'react';
import { Users } from 'lucide-react';
import { CategoryCard } from './CategoryCard';

export const OtherMembersList = () => (
  <CategoryCard
    icon={<Users className="h-5 w-5 text-primary" />}
    title="Other Members"
    description="Additional team members and collaborators"
  />
);
