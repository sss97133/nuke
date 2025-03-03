
import React from 'react';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { TeamMemberFormData } from '../types/TeamMemberTypes';

interface FormFieldsProps {
  formData: TeamMemberFormData;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSelectChange: (name: string, value: string) => void;
}

export const FormFields: React.FC<FormFieldsProps> = ({ 
  formData, 
  handleInputChange, 
  handleSelectChange 
}) => {
  return (
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="fullName" className="text-right">
          Full Name
        </Label>
        <Input
          id="fullName"
          name="fullName"
          value={formData.fullName}
          onChange={handleInputChange}
          className="col-span-3"
          required
        />
      </div>
      
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="email" className="text-right">
          Email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          value={formData.email}
          onChange={handleInputChange}
          className="col-span-3"
          required
        />
      </div>
      
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="position" className="text-right">
          Position
        </Label>
        <Input
          id="position"
          name="position"
          value={formData.position}
          onChange={handleInputChange}
          className="col-span-3"
        />
      </div>
      
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="memberType" className="text-right">
          Member Type
        </Label>
        <Select 
          value={formData.memberType} 
          onValueChange={(value) => handleSelectChange('memberType', value)}
        >
          <SelectTrigger className="col-span-3">
            <SelectValue placeholder="Select member type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="employee">Employee</SelectItem>
            <SelectItem value="contractor">Contractor</SelectItem>
            <SelectItem value="intern">Intern</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
            <SelectItem value="collaborator">Collaborator</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="department" className="text-right">
          Department
        </Label>
        <Input
          id="department"
          name="department"
          value={formData.department}
          onChange={handleInputChange}
          className="col-span-3"
        />
      </div>
      
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="status" className="text-right">
          Status
        </Label>
        <Select 
          value={formData.status} 
          onValueChange={(value) => handleSelectChange('status', value)}
        >
          <SelectTrigger className="col-span-3">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
