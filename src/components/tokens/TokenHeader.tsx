
import { Button } from "@/components/ui/button";
import { Filter, RefreshCw, Plus } from "lucide-react";

interface TokenHeaderProps {
  onRefresh: () => void;
  onOpenFilter: () => void;
  onOpenCreate: () => void;
}

export const TokenHeader = ({ onRefresh, onOpenFilter, onOpenCreate }: TokenHeaderProps) => {
  return (
    <div className="flex justify-between items-center mb-4">
      <h1 className="text-2xl font-bold">Tokens</h1>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onOpenFilter}>
          <Filter className="h-4 w-4 mr-1" />
          Filters
        </Button>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
        <Button variant="default" size="sm" onClick={onOpenCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Create Token
        </Button>
      </div>
    </div>
  );
};
