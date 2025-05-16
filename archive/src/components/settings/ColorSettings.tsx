
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";

interface ColorSettingsProps {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  onPrimaryColorChange: (value: string) => void;
  onSecondaryColorChange: (value: string) => void;
  onAccentColorChange: (value: string) => void;
}

const PRESET_THEMES = {
  "purple": {
    primary: "#9b87f5",
    secondary: "#7E69AB",
    accent: "#8B5CF6"
  },
  "blue": {
    primary: "#1EAEDB",
    secondary: "#0EA5E9",
    accent: "#33C3F0"
  },
  "magenta": {
    primary: "#D946EF",
    secondary: "#9F9EA1",
    accent: "#E5DEFF"
  },
  "orange": {
    primary: "#F97316",
    secondary: "#FEC6A1",
    accent: "#FDE1D3"
  }
};

export const ColorSettings = ({
  primaryColor,
  secondaryColor,
  accentColor,
  onPrimaryColorChange,
  onSecondaryColorChange,
  onAccentColorChange,
}: ColorSettingsProps) => {
  const [selectedPreset, setSelectedPreset] = useState<string>("custom");

  const handlePresetChange = (value: string) => {
    setSelectedPreset(value);
    
    if (value !== "custom") {
      const colors = PRESET_THEMES[value as keyof typeof PRESET_THEMES];
      onPrimaryColorChange(colors.primary);
      onSecondaryColorChange(colors.secondary);
      onAccentColorChange(colors.accent);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Color Settings</h2>
      
      <div className="space-y-2">
        <Label>Color Theme Preset</Label>
        <Select value={selectedPreset} onValueChange={handlePresetChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="custom">Custom</SelectItem>
            <SelectItem value="purple">Purple</SelectItem>
            <SelectItem value="blue">Blue</SelectItem>
            <SelectItem value="magenta">Magenta</SelectItem>
            <SelectItem value="orange">Orange</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="primaryColor">Primary Color</Label>
          <div className="flex items-center gap-2">
            <div 
              className="w-6 h-6 rounded-full border"
              style={{ backgroundColor: primaryColor }}
            />
            <Input 
              id="primaryColor" 
              type="text" 
              value={primaryColor}
              onChange={(e) => {
                onPrimaryColorChange(e.target.value);
                setSelectedPreset("custom");
              }}
            />
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="secondaryColor">Secondary Color</Label>
          <div className="flex items-center gap-2">
            <div 
              className="w-6 h-6 rounded-full border"
              style={{ backgroundColor: secondaryColor }}
            />
            <Input 
              id="secondaryColor" 
              type="text" 
              value={secondaryColor}
              onChange={(e) => {
                onSecondaryColorChange(e.target.value);
                setSelectedPreset("custom");
              }}
            />
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="accentColor">Accent Color</Label>
          <div className="flex items-center gap-2">
            <div 
              className="w-6 h-6 rounded-full border"
              style={{ backgroundColor: accentColor }}
            />
            <Input 
              id="accentColor" 
              type="text" 
              value={accentColor}
              onChange={(e) => {
                onAccentColorChange(e.target.value);
                setSelectedPreset("custom");
              }}
            />
          </div>
        </div>
      </div>
      
      <div className="pt-2">
        <div className="rounded-md p-4 flex gap-3 justify-center" style={{ backgroundColor: primaryColor }}>
          <Button variant="outline" style={{ backgroundColor: secondaryColor }}>
            Preview
          </Button>
          <Button style={{ backgroundColor: accentColor }}>
            Accent
          </Button>
        </div>
      </div>
    </div>
  );
};
