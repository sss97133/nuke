
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ServiceRecordCard from './ServiceRecordCard';
import { ServiceRecord } from './types';

interface ServiceTabsProps {
  serviceRecords: ServiceRecord[];
}

const ServiceTabs = ({ serviceRecords }: ServiceTabsProps) => {
  return (
    <Tabs defaultValue="all" className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="all">All Records</TabsTrigger>
        <TabsTrigger value="completed">Completed</TabsTrigger>
        <TabsTrigger value="in-progress">In Progress</TabsTrigger>
        <TabsTrigger value="pending">Pending</TabsTrigger>
      </TabsList>
      
      <TabsContent value="all" className="space-y-4">
        {serviceRecords.map((record) => (
          <ServiceRecordCard key={record.id} record={record} />
        ))}
      </TabsContent>
      
      <TabsContent value="completed" className="space-y-4">
        {serviceRecords
          .filter(record => record.status === 'completed')
          .map((record) => (
            <ServiceRecordCard key={record.id} record={record} />
          ))}
      </TabsContent>
      
      <TabsContent value="in-progress" className="space-y-4">
        {serviceRecords
          .filter(record => record.status === 'in-progress')
          .map((record) => (
            <ServiceRecordCard key={record.id} record={record} />
          ))}
      </TabsContent>
      
      <TabsContent value="pending" className="space-y-4">
        {serviceRecords
          .filter(record => record.status === 'pending')
          .map((record) => (
            <ServiceRecordCard key={record.id} record={record} />
          ))}
      </TabsContent>
    </Tabs>
  );
};

export default ServiceTabs;
