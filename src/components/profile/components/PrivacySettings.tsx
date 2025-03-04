
import React, { useState } from 'react';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Shield, Eye, EyeOff, Users, Lock } from 'lucide-react';

interface PrivacyOption {
  id: string;
  label: string;
  description: string;
  defaultValue: boolean;
}

const privacyOptions: PrivacyOption[] = [
  {
    id: 'show_email',
    label: 'Show email address',
    description: 'Allow others to see your email address',
    defaultValue: false
  },
  {
    id: 'show_social',
    label: 'Show social media links',
    description: 'Display your connected social media accounts',
    defaultValue: true
  },
  {
    id: 'show_achievements',
    label: 'Show achievements',
    description: 'Display your badges and achievements',
    defaultValue: true
  },
  {
    id: 'show_vehicles',
    label: 'Show vehicle collection',
    description: 'Let others see vehicles in your garage',
    defaultValue: true
  },
  {
    id: 'show_activity',
    label: 'Show activity history',
    description: 'Display your recent platform activity',
    defaultValue: true
  },
  {
    id: 'discoverable',
    label: 'Discoverable profile',
    description: 'Allow your profile to appear in searches',
    defaultValue: true
  }
];

interface PrivacyPreset {
  id: 'public' | 'limited' | 'private';
  name: string;
  description: string;
  icon: React.ReactNode;
}

const privacyPresets: PrivacyPreset[] = [
  {
    id: 'public',
    name: 'Public',
    description: 'Everything is visible to everyone',
    icon: <Eye className="h-5 w-5" />
  },
  {
    id: 'limited',
    name: 'Limited',
    description: 'Only essential information is public',
    icon: <Users className="h-5 w-5" />
  },
  {
    id: 'private',
    name: 'Private',
    description: 'Most information is hidden from public view',
    icon: <EyeOff className="h-5 w-5" />
  }
];

interface PrivacySettingsProps {
  userId: string;
  recommendedPrivacy?: 'public' | 'limited' | 'private';
}

export const PrivacySettings: React.FC<PrivacySettingsProps> = ({ 
  userId,
  recommendedPrivacy = 'limited'
}) => {
  console.log('Rendering PrivacySettings for user:', userId, 'with recommended privacy:', recommendedPrivacy);
  
  const { toast } = useToast();
  const [currentPreset, setCurrentPreset] = useState<string>(recommendedPrivacy);
  const [settings, setSettings] = useState<Record<string, boolean>>(
    privacyOptions.reduce((acc, option) => ({
      ...acc,
      [option.id]: option.defaultValue
    }), {})
  );
  const [isCustom, setIsCustom] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const applyPreset = (presetId: 'public' | 'limited' | 'private') => {
    console.log('Applying privacy preset:', presetId);
    
    let newSettings: Record<string, boolean> = {};
    
    // Apply settings based on preset
    switch (presetId) {
      case 'public':
        newSettings = privacyOptions.reduce((acc, option) => ({
          ...acc,
          [option.id]: true
        }), {});
        break;
      case 'limited':
        newSettings = {
          show_email: false,
          show_social: true,
          show_achievements: true,
          show_vehicles: true,
          show_activity: false,
          discoverable: true
        };
        break;
      case 'private':
        newSettings = {
          show_email: false,
          show_social: false,
          show_achievements: true,
          show_vehicles: false,
          show_activity: false,
          discoverable: false
        };
        break;
    }
    
    setSettings(newSettings);
    setCurrentPreset(presetId);
    setIsCustom(false);
  };

  const handleToggle = (optionId: string, value: boolean) => {
    console.log('Privacy option toggled:', optionId, value);
    
    setSettings(prev => ({
      ...prev,
      [optionId]: value
    }));
    setIsCustom(true);
    setCurrentPreset('');
  };

  const saveSettings = async () => {
    console.log('Saving privacy settings:', settings);
    
    setIsSaving(true);
    
    try {
      // Simulating API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Here you would save to your database
      
      toast({
        title: "Privacy settings saved",
        description: "Your privacy preferences have been updated successfully.",
      });
      
      console.log('Privacy settings saved successfully');
    } catch (error) {
      console.error('Error saving privacy settings:', error);
      
      toast({
        title: "Error saving settings",
        description: "Please try again later.",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xl flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Privacy Settings
        </CardTitle>
        <CardDescription>
          Control who can see your profile information and how you appear to others
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <div className="mb-6">
          <h3 className="text-sm font-medium mb-3">Privacy Level</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {privacyPresets.map((preset) => (
              <div 
                key={preset.id}
                className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                  currentPreset === preset.id ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                }`}
                onClick={() => applyPreset(preset.id)}
              >
                <div className="flex items-center gap-2 mb-1">
                  {preset.icon}
                  <span className="font-medium">{preset.name}</span>
                  {preset.id === recommendedPrivacy && (
                    <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded ml-auto">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{preset.description}</p>
              </div>
            ))}
          </div>
          
          {isCustom && (
            <div className="flex items-center gap-2 mt-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Custom settings applied</span>
            </div>
          )}
        </div>
        
        <div className="space-y-4">
          <h3 className="text-sm font-medium">Detailed Privacy Options</h3>
          {privacyOptions.map((option) => (
            <div key={option.id} className="flex items-center justify-between">
              <div className="space-y-0.5">
                <label 
                  htmlFor={option.id}
                  className="text-sm font-medium cursor-pointer"
                >
                  {option.label}
                </label>
                <p className="text-xs text-muted-foreground">
                  {option.description}
                </p>
              </div>
              <Switch
                id={option.id}
                checked={settings[option.id]}
                onCheckedChange={(checked) => handleToggle(option.id, checked)}
              />
            </div>
          ))}
        </div>
      </CardContent>
      
      <CardFooter className="border-t pt-5 flex justify-between">
        <Button 
          variant="outline"
          onClick={() => applyPreset(recommendedPrivacy)}
        >
          Reset to Recommended
        </Button>
        <Button
          onClick={saveSettings}
          disabled={isSaving}
        >
          {isSaving ? (
            <>
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </Button>
      </CardFooter>
    </Card>
  );
};
