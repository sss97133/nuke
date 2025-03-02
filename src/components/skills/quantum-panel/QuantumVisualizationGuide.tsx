
import React from 'react';
import { Button } from '@/components/ui/button';
import { CardFooter } from '@/components/ui/card';
import { ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface QuantumVisualizationGuideProps {
  showHelp: boolean;
}

export const QuantumVisualizationGuide: React.FC<QuantumVisualizationGuideProps> = ({
  showHelp
}) => {
  return (
    <Collapsible open={showHelp}>
      <CollapsibleTrigger asChild>
        <CardFooter className="justify-between border-t p-4 py-2">
          <div className="text-sm font-medium">Visualization Guide</div>
          <Button variant="ghost" size="sm">
            <ChevronDown className={`h-4 w-4 ${showHelp ? 'rotate-180' : ''} transition-transform`} />
          </Button>
        </CardFooter>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-6 pb-4 text-sm space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <h4 className="font-medium">Orbits</h4>
              <p className="text-muted-foreground">
                Each orbit represents a skill category. The size and color indicate different domains of expertise.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium">Particles</h4>
              <p className="text-muted-foreground">
                Particles represent individual skills. Their density and brightness increase with your skill level.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium">Motion</h4>
              <p className="text-muted-foreground">
                The orbit rotation speed and particle behavior reflect your overall career momentum and skill coherence.
              </p>
            </div>
          </div>
          <div className="pt-2 border-t space-y-2">
            <h4 className="font-medium">Interaction Tips</h4>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1">
              <li>Use mouse to rotate and zoom the visualization</li>
              <li>Filter by category or skill to focus on specific areas</li>
              <li>Toggle between 2D and 3D views for different perspectives</li>
              <li>Adjust interaction strength to see quantum effects</li>
              <li>Take screenshots to share your skill visualization</li>
            </ul>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
