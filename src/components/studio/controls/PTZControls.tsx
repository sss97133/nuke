import React from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Plus, Minus } from 'lucide-react';

export const PTZControls = () => {
  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">PTZ Camera Controls</h3>
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-2 place-items-center">
          <div />
          <Button variant="outline" size="icon">
            <ArrowUp className="h-4 w-4" />
          </Button>
          <div />
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon">
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Zoom</Label>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon">
                <Minus className="h-4 w-4" />
              </Button>
              <Slider defaultValue={[50]} max={100} step={1} />
              <Button variant="outline" size="icon">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          <div className="space-y-2">
            <Label>Speed</Label>
            <Slider defaultValue={[50]} max={100} step={1} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline">Preset 1</Button>
          <Button variant="outline">Preset 2</Button>
          <Button variant="outline">Preset 3</Button>
        </div>
      </div>
    </Card>
  );
};