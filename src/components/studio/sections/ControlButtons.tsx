
import React from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Save, Settings } from 'lucide-react';

interface ControlButtonsProps {
  isAutoSave: boolean;
  setIsAutoSave: (value: boolean) => void;
  handleSavePreset: () => void;
  handleSaveConfiguration: () => void;
}

export const ControlButtons: React.FC<ControlButtonsProps> = ({
  isAutoSave,
  setIsAutoSave,
  handleSavePreset,
  handleSaveConfiguration
}) => {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center space-x-2">
        <Switch 
          id="auto-save"
          checked={isAutoSave}
          onCheckedChange={setIsAutoSave}
        />
        <Label htmlFor="auto-save">Auto-save</Label>
      </div>
      
      <Button onClick={handleSavePreset} className="flex items-center gap-2">
        <Save className="h-4 w-4" />
        Save as Preset
      </Button>
      
      <Button 
        onClick={handleSaveConfiguration}
        className="flex items-center gap-2"
      >
        <Settings className="h-4 w-4" />
        Save Configuration
      </Button>
    </div>
  );
};
