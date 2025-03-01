
import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Wrench, Calendar, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

interface ServiceRecord {
  id: string;
  description: string;
  status: string;
  service_date: string;
  completion_date?: string;
  service_type?: string;
  technician_notes?: string;
  labor_hours?: number;
  parts_used?: {name: string, quantity: number, cost: number}[];
  vehicle: {
    make: string;
    model: string;
    year: number;
  };
}

const ServiceHistory = () => {
  const { data: serviceRecords, isLoading, error } = useQuery({
    queryKey: ['service-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_tickets')
        .select(`
          id,
          description,
          status,
          service_date,
          completion_date,
          service_type,
          technician_notes,
          labor_hours,
          parts_used,
          vehicle_id,
          vehicles:vehicle_id (make, model, year)
        `)
        .order('service_date', { ascending: false });
        
      if (error) throw error;
      return data as ServiceRecord[];
    }
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <h1 className="text-3xl font-bold mb-6">Service History</h1>
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse flex flex-col items-center">
            <Wrench className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Loading service history...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Service History</h1>
        <Card className="border-destructive/50">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <AlertCircle className="h-12 w-12 text-destructive mb-4" />
              <h3 className="text-xl font-medium mb-2">Unable to load service history</h3>
              <p className="text-muted-foreground mb-4">
                There was an error fetching your service records. Please try again later.
              </p>
              <p className="text-xs text-muted-foreground border p-2 rounded bg-muted">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!serviceRecords || serviceRecords.length === 0) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-3xl font-bold mb-6">Service History</h1>
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <Wrench className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-xl font-medium mb-2">No service records found</h3>
              <p className="text-muted-foreground">
                You don't have any service records yet. When you create service tickets, they will appear here.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Service History</h1>
      </div>
      
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
    </div>
  );
};

const ServiceRecordCard = ({ record }: { record: ServiceRecord }) => {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500">Completed</Badge>;
      case 'in-progress':
        return <Badge className="bg-blue-500">In Progress</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-500">Pending</Badge>;
      default:
        return <Badge className="bg-gray-500">{status}</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>
              {record.vehicle ? `${record.vehicle.year} ${record.vehicle.make} ${record.vehicle.model}` : 'Unknown Vehicle'}
            </CardTitle>
            <CardDescription className="mt-1">
              {record.description}
            </CardDescription>
          </div>
          <div>
            {getStatusBadge(record.status)}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Service Date: {formatDate(record.service_date)}</span>
            </div>
            
            {record.completion_date && (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Completion Date: {formatDate(record.completion_date)}</span>
              </div>
            )}
            
            {record.labor_hours !== undefined && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Labor Hours: {record.labor_hours}</span>
              </div>
            )}
          </div>
          
          <div>
            {record.technician_notes && (
              <div className="mb-4">
                <h4 className="text-sm font-medium mb-1">Technician Notes</h4>
                <p className="text-sm text-muted-foreground">{record.technician_notes}</p>
              </div>
            )}
            
            {record.parts_used && record.parts_used.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-1">Parts Used</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {record.parts_used.map((part, index) => (
                    <li key={index}>{part.name} × {part.quantity}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ServiceHistory;
