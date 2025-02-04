import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ServiceDetailsProps {
  description: string;
  serviceType: string;
  onDescriptionChange: (value: string) => void;
  onServiceTypeChange: (value: string) => void;
}

export const ServiceDetails = ({
  description,
  serviceType,
  onDescriptionChange,
  onServiceTypeChange,
}: ServiceDetailsProps) => {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="serviceType">Service Type</Label>
        <Select value={serviceType} onValueChange={onServiceTypeChange}>
          <SelectTrigger>
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

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Describe the service needed..."
          className="min-h-[100px]"
        />
      </div>
    </div>
  );
};