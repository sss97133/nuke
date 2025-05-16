
import React from 'react';
import { Briefcase } from 'lucide-react';
import { CategoryCard } from './CategoryCard';

export const ConsultantsList = () => (
  <CategoryCard
    icon={<Briefcase className="h-5 w-5 text-primary" />}
    title="Consultants"
    description="Advisors and specialists for vehicle projects"
  />
);
