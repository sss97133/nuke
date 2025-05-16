
import { FilterCheckbox } from "./FilterCheckbox";

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
        <FilterCheckbox
          key={filter.id}
          id={filter.id}
          label={filter.label}
          checked={filter.enabled}
          onCheckedChange={(checked) => onFilterChange(filter.id, checked)}
        />
      ))}
    </div>
  );
};

