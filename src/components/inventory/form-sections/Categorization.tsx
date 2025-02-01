import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CategorizationProps {
  department: string;
  subDepartment: string;
  assetType: string;
  condition: string;
  onDepartmentChange: (value: string) => void;
  onSubDepartmentChange: (value: string) => void;
  onAssetTypeChange: (value: string) => void;
  onConditionChange: (value: string) => void;
}

export const Categorization = ({
  department,
  subDepartment,
  assetType,
  condition,
  onDepartmentChange,
  onSubDepartmentChange,
  onAssetTypeChange,
  onConditionChange,
}: CategorizationProps) => {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-[#283845]">Categorization</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="department">Department</Label>
          <Select value={department} onValueChange={onDepartmentChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="maintenance">Maintenance</SelectItem>
              <SelectItem value="kitchen">Kitchen</SelectItem>
              <SelectItem value="office">Office</SelectItem>
              <SelectItem value="it">IT</SelectItem>
              <SelectItem value="facilities">Facilities</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="subDepartment">Sub-Department</Label>
          <Input
            id="subDepartment"
            value={subDepartment}
            onChange={(e) => onSubDepartmentChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="assetType">Asset Type</Label>
          <Select value={assetType} onValueChange={onAssetTypeChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select asset type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tool">Tool</SelectItem>
              <SelectItem value="equipment">Equipment</SelectItem>
              <SelectItem value="furniture">Furniture</SelectItem>
              <SelectItem value="supplies">Supplies</SelectItem>
              <SelectItem value="electronics">Electronics</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="condition">Condition</Label>
          <Select value={condition} onValueChange={onConditionChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select condition" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="excellent">Excellent</SelectItem>
              <SelectItem value="good">Good</SelectItem>
              <SelectItem value="fair">Fair</SelectItem>
              <SelectItem value="poor">Poor</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};