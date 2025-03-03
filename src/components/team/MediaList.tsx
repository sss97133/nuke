
import React from 'react';
import { Video } from 'lucide-react';
import { CategoryCard } from './CategoryCard';

export const MediaList = () => (
  <CategoryCard
    icon={<Video className="h-5 w-5 text-primary" />}
    title="Media & Documentation"
    description="Content creators and documentation specialists"
  />
);
