
import React from 'react';
import { Building2 } from 'lucide-react';
import { CategoryCard } from './CategoryCard';

export const ServiceBusinessesList = () => (
  <CategoryCard
    icon={<Building2 className="h-5 w-5 text-primary" />}
    title="Service Businesses"
    description="Service centers, repair shops, and specialized vendors you work with"
  />
);
