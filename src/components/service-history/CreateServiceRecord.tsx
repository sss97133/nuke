
import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PartItem } from './types';
import { Trash, Plus } from 'lucide-react';

interface CreateServiceRecordProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
}

const CreateServiceRecord: React.FC<CreateServiceRecordProps> = ({ isOpen, onClose, onSuccess }) => {
  const [description, setDescription] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [serviceType, setServiceType] = useState('routine_maintenance');
  const [status, setStatus] = useState('pending');
  const [technicianNotes, setTechnicianNotes] = useState('');
  const [laborHours, setLaborHours] = useState<number | undefined>(undefined);
  const [parts, setParts] = useState<PartItem[]>([]);
  const [newPart, setNewPart] = useState<PartItem>({ name: '', quantity: 1, cost: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setDescription('');
      setVehicleId('');
      setServiceType('routine_maintenance');
      setStatus('pending');
      setTechnicianNotes('');
      setLaborHours(undefined);
      setParts([]);
      setNewPart({ name: '', quantity: 1, cost: 0 });
      setError(null);
    }
  }, [isOpen]);

  // Fetch vehicles for dropdown
  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, make, model, year')
        .order('make');
        
      if (error) throw error;
      return data as Vehicle[];
    }
  });

  const addPart = () => {
    if (newPart.name.trim() === '') return;
    
    setParts([...parts, { ...newPart }]);
    setNewPart({ name: '', quantity: 1, cost: 0 });
  };

  const removePart = (index: number) => {
    setParts(parts.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!description || !vehicleId) {
      setError('Description and vehicle are required fields');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { error: insertError } = await supabase
        .from('service_tickets')
        .insert({
          description,
          vehicle_id: vehicleId,
          service_type: serviceType,
          status,
          technician_notes: technicianNotes || null,
          labor_hours: laborHours || 0,
          parts_used: parts.length > 0 ? parts : null,
          service_date: new Date().toISOString(),
        });

      if (insertError) throw insertError;
      
      onSuccess();
    } catch (err: any) {
      console.error('Error creating service record:', err);
      setError(err.message || 'Failed to create service record');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Service Record</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/15 text-destructive p-3 rounded-md mb-4">
            {error}
          </div>
        )}

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="vehicle">Vehicle</Label>
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger id="vehicle">
                <SelectValue placeholder="Select a vehicle" />
              </SelectTrigger>
              <SelectContent>
                {vehicles?.map((vehicle) => (
                  <SelectItem key={vehicle.id} value={vehicle.id}>
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </SelectItem>
                )) || <SelectItem value="loading">Loading vehicles...</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the service performed"
              className="min-h-[80px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="serviceType">Service Type</Label>
              <Select value={serviceType} onValueChange={setServiceType}>
                <SelectTrigger id="serviceType">
                  <SelectValue placeholder="Select service type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="routine_maintenance">Routine Maintenance</SelectItem>
                  <SelectItem value="repair">Repair</SelectItem>
                  <SelectItem value="inspection">Inspection</SelectItem>
                  <SelectItem value="modification">Modification</SelectItem>
                  <SelectItem value="emergency">Emergency</SelectItem>
                  <SelectItem value="recall">Recall</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in-progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="laborHours">Labor Hours</Label>
            <Input
              id="laborHours"
              type="number"
              min="0"
              step="0.5"
              value={laborHours || ''}
              onChange={(e) => setLaborHours(e.target.value ? parseFloat(e.target.value) : undefined)}
              placeholder="Enter labor hours"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="technicianNotes">Technician Notes</Label>
            <Textarea
              id="technicianNotes"
              value={technicianNotes}
              onChange={(e) => setTechnicianNotes(e.target.value)}
              placeholder="Additional notes about the service"
              className="min-h-[80px]"
            />
          </div>

          <div className="grid gap-2">
            <Label>Parts Used</Label>
            <div className="grid grid-cols-[1fr,80px,120px,40px] gap-2 items-end">
              <Input
                placeholder="Part name"
                value={newPart.name}
                onChange={(e) => setNewPart({ ...newPart, name: e.target.value })}
              />
              <Input
                type="number"
                min="1"
                placeholder="Qty"
                value={newPart.quantity}
                onChange={(e) => setNewPart({ ...newPart, quantity: parseInt(e.target.value) || 1 })}
              />
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Cost"
                value={newPart.cost}
                onChange={(e) => setNewPart({ ...newPart, cost: parseFloat(e.target.value) || 0 })}
              />
              <Button type="button" onClick={addPart} variant="outline" size="icon">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {parts.length > 0 && (
              <div className="border rounded-md divide-y">
                {parts.map((part, index) => (
                  <div key={index} className="flex justify-between items-center p-2">
                    <div>
                      <span className="font-medium">{part.name}</span>
                      <span className="text-sm text-muted-foreground ml-2">
                        (Qty: {part.quantity}, Cost: ${part.cost.toFixed(2)})
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removePart(index)}
                    >
                      <Trash className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Service Record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateServiceRecord;
