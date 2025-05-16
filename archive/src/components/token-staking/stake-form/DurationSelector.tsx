
import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DurationSelectorProps {
  duration: string;
  onDurationChange: (value: string) => void;
}

const DurationSelector = ({ duration, onDurationChange }: DurationSelectorProps) => {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Stake Duration (Days)</label>
      <Select value={duration} onValueChange={onDurationChange}>
        <SelectTrigger className="transition-all duration-200 hover:border-primary">
          <SelectValue placeholder="Select duration" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="30" className="transition-colors hover:bg-primary/10">30 Days</SelectItem>
          <SelectItem value="60" className="transition-colors hover:bg-primary/10">60 Days</SelectItem>
          <SelectItem value="90" className="transition-colors hover:bg-primary/10">90 Days</SelectItem>
          <SelectItem value="180" className="transition-colors hover:bg-primary/10">180 Days</SelectItem>
          <SelectItem value="365" className="transition-colors hover:bg-primary/10">365 Days</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};

export default DurationSelector;
