
import React from 'react';
import { Wrench } from 'lucide-react';
import { CategoryCard } from './CategoryCard';

export const TechniciansList = () => (
  <CategoryCard
    icon={<Wrench className="h-5 w-5 text-primary" />}
    title="Technicians"
    description="Professionals who service your vehicles"
  />
);
