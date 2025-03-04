
import { Button } from '@/components/ui/button';

interface FilterActionsProps {
  onApply: () => void;
  onClear: () => void;
}

export const FilterActions = ({ onApply, onClear }: FilterActionsProps) => {
  return (
    <div className="flex justify-end space-x-2">
      <Button variant="outline" onClick={onClear}>
        Clear Filters
      </Button>
      <Button onClick={onApply}>
        Apply Filters
      </Button>
    </div>
  );
};
