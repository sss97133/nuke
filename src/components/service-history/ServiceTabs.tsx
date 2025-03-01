
import React, { useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ServiceRecordCard from './ServiceRecordCard';
import { ServiceRecord } from './types';

interface ServiceTabsProps {
  serviceRecords: ServiceRecord[];
}

const ServiceTabs = ({ serviceRecords }: ServiceTabsProps) => {
  // Pre-calculate filtered records for each tab
  const completedRecords = useMemo(() => 
    serviceRecords.filter(record => record.status === 'completed'), 
    [serviceRecords]
  );

  const inProgressRecords = useMemo(() => 
    serviceRecords.filter(record => record.status === 'in-progress'), 
    [serviceRecords]
  );

  const pendingRecords = useMemo(() => 
    serviceRecords.filter(record => record.status === 'pending'), 
    [serviceRecords]
  );

  return (
    <Tabs defaultValue="all" className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="all">All Records ({serviceRecords.length})</TabsTrigger>
        <TabsTrigger value="completed">Completed ({completedRecords.length})</TabsTrigger>
        <TabsTrigger value="in-progress">In Progress ({inProgressRecords.length})</TabsTrigger>
        <TabsTrigger value="pending">Pending ({pendingRecords.length})</TabsTrigger>
      </TabsList>
      
      <TabsContent value="all" className="space-y-4">
        {serviceRecords.length === 0 ? (
          <p className="text-center py-4 text-muted-foreground">No records to display.</p>
        ) : (
          serviceRecords.map((record) => (
            <ServiceRecordCard key={record.id} record={record} />
          ))
        )}
      </TabsContent>
      
      <TabsContent value="completed" className="space-y-4">
        {completedRecords.length === 0 ? (
          <p className="text-center py-4 text-muted-foreground">No completed service records.</p>
        ) : (
          completedRecords.map((record) => (
            <ServiceRecordCard key={record.id} record={record} />
          ))
        )}
      </TabsContent>
      
      <TabsContent value="in-progress" className="space-y-4">
        {inProgressRecords.length === 0 ? (
          <p className="text-center py-4 text-muted-foreground">No in-progress service records.</p>
        ) : (
          inProgressRecords.map((record) => (
            <ServiceRecordCard key={record.id} record={record} />
          ))
        )}
      </TabsContent>
      
      <TabsContent value="pending" className="space-y-4">
        {pendingRecords.length === 0 ? (
          <p className="text-center py-4 text-muted-foreground">No pending service records.</p>
        ) : (
          pendingRecords.map((record) => (
            <ServiceRecordCard key={record.id} record={record} />
          ))
        )}
      </TabsContent>
    </Tabs>
  );
};

export default ServiceTabs;
