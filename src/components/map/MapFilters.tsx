
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export type MapFilter = {
  id: string;
  label: string;
  enabled: boolean;
};

interface MapFiltersProps {
  filters: MapFilter[];
  onFilterChange: (id: string, enabled: boolean) => void;
}

export const MapFilters = ({ filters, onFilterChange }: MapFiltersProps) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4 bg-card rounded-lg shadow-sm mb-4">
      {filters.map((filter) => (
        <div key={filter.id} className="flex items-center space-x-2">
          <Checkbox
            id={filter.id}
            checked={filter.enabled}
            onCheckedChange={(checked) => onFilterChange(filter.id, checked as boolean)}
          />
          <Label htmlFor={filter.id} className="text-sm cursor-pointer">
            {filter.label}
          </Label>
        </div>
      ))}
    </div>
  );
};
