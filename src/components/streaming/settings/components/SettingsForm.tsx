
import React from 'react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Check } from "lucide-react";

interface SettingsFormProps {
  streamTitle: string;
  onTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  category: string;
  onCategoryChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isPublic: boolean;
  onPublicChange: (checked: boolean) => void;
  onSave: () => void;
  error: string | null;
  success: string | null;
}

export const SettingsForm: React.FC<SettingsFormProps> = ({
  streamTitle,
  onTitleChange,
  category,
  onCategoryChange,
  isPublic,
  onPublicChange,
  onSave,
  error,
  success
}) => {
  return (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      {success && (
        <Alert className="bg-green-50 border-green-200 text-green-800">
          <Check className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
      
      <div className="space-y-2">
        <Label htmlFor="streamTitle">Stream Title</Label>
        <Input 
          id="streamTitle" 
          value={streamTitle} 
          onChange={onTitleChange}
          placeholder="Enter a catchy title for your stream"
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="category">Category / Game</Label>
        <Input 
          id="category" 
          value={category} 
          onChange={onCategoryChange}
          placeholder="e.g. Automotive, Just Chatting, etc."
        />
      </div>
      
      <div className="flex items-center space-x-2 pt-2">
        <Switch 
          id="isPublic" 
          checked={isPublic} 
          onCheckedChange={onPublicChange} 
        />
        <Label htmlFor="isPublic">Public Stream</Label>
      </div>
      
      <div className="pt-4">
        <Button onClick={onSave}>
          Save Settings
        </Button>
      </div>
    </>
  );
};
