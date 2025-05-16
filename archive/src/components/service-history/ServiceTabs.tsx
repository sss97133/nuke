
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ServiceStatus } from './types';

interface ServiceTabsProps {
  activeTab: ServiceStatus | 'all';
  onTabChange: (value: ServiceStatus | 'all') => void;
  counts: {
    all: number;
    completed: number;
    'in-progress': number;
    pending: number;
  }
}

const ServiceTabs = ({ activeTab, onTabChange, counts }: ServiceTabsProps) => {
  return (
    <Tabs value={activeTab} onValueChange={(value) => onTabChange(value as ServiceStatus | 'all')} className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="all">All Records ({counts.all})</TabsTrigger>
        <TabsTrigger value="completed">Completed ({counts.completed})</TabsTrigger>
        <TabsTrigger value="in-progress">In Progress ({counts['in-progress']})</TabsTrigger>
        <TabsTrigger value="pending">Pending ({counts.pending})</TabsTrigger>
      </TabsList>
    </Tabs>
  );
};

export default ServiceTabs;
