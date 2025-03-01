
import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Calendar, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ServiceRecord } from './types';

export const getStatusBadge = (status: string) => {
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

export const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

const ServiceRecordCard = ({ record }: { record: ServiceRecord }) => {
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

export default ServiceRecordCard;
