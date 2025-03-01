
import React from 'react';
import { format } from 'date-fns';
import { ServiceRecord } from './types';
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Wrench, Calendar, Clock, User, Car } from 'lucide-react';

interface ServiceRecordCardProps {
  record: ServiceRecord;
}

const getStatusColor = (status: string) => {
  switch(status) {
    case 'completed': return 'bg-green-500';
    case 'in-progress': return 'bg-blue-500';
    case 'pending': return 'bg-amber-500';
    default: return 'bg-slate-500';
  }
};

const formatDate = (dateString: string) => {
  try {
    return format(new Date(dateString), 'MMM d, yyyy');
  } catch (e) {
    return 'Invalid date';
  }
};

const formatServiceType = (type?: string) => {
  if (!type) return 'Unknown';
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const ServiceRecordCard: React.FC<ServiceRecordCardProps> = ({ record }) => {
  const totalPartsCost = record.parts_used?.reduce((sum, part) => sum + (part.cost * part.quantity), 0) || 0;
  
  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>{record.description}</CardTitle>
            <CardDescription className="mt-1 flex items-center gap-1">
              <Car className="h-4 w-4 text-muted-foreground" />
              {record.vehicle.year} {record.vehicle.make} {record.vehicle.model}
            </CardDescription>
          </div>
          <Badge className={`${getStatusColor(record.status)} text-white`}>
            {record.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-2">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center text-sm">
              <Wrench className="h-4 w-4 mr-2 text-muted-foreground" />
              <span className="font-medium mr-1">Service Type:</span>
              {formatServiceType(record.service_type)}
            </div>
            
            <div className="flex items-center text-sm">
              <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
              <span className="font-medium mr-1">Service Date:</span>
              {formatDate(record.service_date)}
            </div>
            
            {record.completion_date && (
              <div className="flex items-center text-sm">
                <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                <span className="font-medium mr-1">Completion Date:</span>
                {formatDate(record.completion_date)}
              </div>
            )}
          </div>
          
          <div className="space-y-2">
            {record.labor_hours !== undefined && (
              <div className="flex items-center text-sm">
                <Clock className="h-4 w-4 mr-2 text-muted-foreground" />
                <span className="font-medium mr-1">Labor Hours:</span>
                {record.labor_hours}
              </div>
            )}
            
            {record.parts_used && record.parts_used.length > 0 && (
              <div className="flex items-center text-sm">
                <span className="font-medium mr-1">Parts Used:</span>
                {record.parts_used.length} items (${totalPartsCost.toFixed(2)})
              </div>
            )}
          </div>
        </div>
        
        {record.technician_notes && (
          <div className="mt-4">
            <h4 className="text-sm font-medium mb-1">Technician Notes:</h4>
            <p className="text-sm text-muted-foreground">{record.technician_notes}</p>
          </div>
        )}
      </CardContent>
      
      {record.parts_used && record.parts_used.length > 0 && (
        <CardFooter className="pt-2 flex-col items-start">
          <h4 className="text-sm font-medium mb-2">Parts:</h4>
          <div className="w-full grid gap-1">
            {record.parts_used.map((part, index) => (
              <div key={index} className="text-xs border-t py-1 grid grid-cols-3">
                <span>{part.name}</span>
                <span>Qty: {part.quantity}</span>
                <span className="text-right">${(part.cost * part.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </CardFooter>
      )}
    </Card>
  );
};

export default ServiceRecordCard;
