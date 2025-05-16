
import React from 'react';
import { Atom, Info } from 'lucide-react';
import { CardTitle, CardDescription, CardHeader } from "@/components/ui/card";
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface QuantumSkillPanelHeaderProps {
  showLegacy: boolean;
  setShowLegacy: (show: boolean) => void;
  toggleHelp: () => void;
}

export const QuantumSkillPanelHeader: React.FC<QuantumSkillPanelHeaderProps> = ({
  showLegacy,
  setShowLegacy,
  toggleHelp
}) => {
  return (
    <CardHeader className="flex flex-row items-center justify-between space-y-0">
      <div>
        <CardTitle className="text-2xl font-semibold flex items-center gap-2">
          <Atom className="h-6 w-6 text-primary" />
          Quantum Skill Visualization
        </CardTitle>
        <CardDescription>
          Interactive visualization of your skill development in quantum space
        </CardDescription>
      </div>
      <div className="flex items-center gap-4">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={toggleHelp}>
                <Info className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Toggle visualization guide</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex items-center space-x-2">
          <Switch
            id="legacy-mode"
            checked={showLegacy}
            onCheckedChange={setShowLegacy}
          />
          <label htmlFor="legacy-mode" className="text-sm cursor-pointer">Legacy View</label>
        </div>
      </div>
    </CardHeader>
  );
};
