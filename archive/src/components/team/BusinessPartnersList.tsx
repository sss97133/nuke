
import React from 'react';
import { Coins } from 'lucide-react';
import { CategoryCard } from './CategoryCard';

export const BusinessPartnersList = () => (
  <CategoryCard
    icon={<Coins className="h-5 w-5 text-primary" />}
    title="Business Partners"
    description="Suppliers, vendors, and service providers for your operations"
  />
);
