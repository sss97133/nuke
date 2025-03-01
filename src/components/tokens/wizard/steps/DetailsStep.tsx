
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DetailsStepProps {
  description: string;
  status: string;
  onDescriptionChange: (value: string) => void;
  onStatusChange: (value: string) => void;
}

const DetailsStep = ({ 
  description, 
  status, 
  onDescriptionChange, 
  onStatusChange 
}: DetailsStepProps) => {
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label htmlFor="token-description">Description</Label>
        <Textarea
          id="token-description"
          placeholder="Describe the purpose and features of your token"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={4}
        />
        <p className="text-sm text-muted-foreground">
          Provide details about what your token represents and how it can be used
        </p>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="token-status">Initial Status</Label>
        <Select 
          value={status} 
          onValueChange={onStatusChange}
        >
          <SelectTrigger id="token-status">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          Set the initial status of your token
        </p>
      </div>
    </div>
  );
};

export default DetailsStep;
