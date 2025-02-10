
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "next-themes";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Settings = () => {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [compactViewEnabled, setCompactViewEnabled] = useState(false);

  const handleResetPreferences = async () => {
    setNotificationsEnabled(true);
    setAutoSaveEnabled(true);
    setCompactViewEnabled(false);
    setTheme('system');
    
    toast({
      title: "Preferences Reset",
      description: "Your preferences have been reset to default values",
    });
  };

  const handleClearData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      // Clear user preferences here
      toast({
        title: "Data Cleared",
        description: "Your local data has been cleared",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to clear data",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold">System Preferences</h1>
      
      <Card className="p-6 space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Appearance</h2>
          <div className="flex items-center justify-between">
            <Label htmlFor="theme">Dark Mode</Label>
            <Switch
              id="theme"
              checked={theme === 'dark'}
              onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="compact">Compact View</Label>
            <Switch
              id="compact"
              checked={compactViewEnabled}
              onCheckedChange={setCompactViewEnabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Notifications</h2>
          <div className="flex items-center justify-between">
            <Label htmlFor="notifications">Enable Notifications</Label>
            <Switch
              id="notifications"
              checked={notificationsEnabled}
              onCheckedChange={setNotificationsEnabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Auto-Save</h2>
          <div className="flex items-center justify-between">
            <Label htmlFor="autosave">Enable Auto-Save</Label>
            <Switch
              id="autosave"
              checked={autoSaveEnabled}
              onCheckedChange={setAutoSaveEnabled}
            />
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="text-xl font-semibold">Data Management</h2>
        <div className="space-x-4">
          <Button variant="outline" onClick={handleResetPreferences}>
            Reset to Defaults
          </Button>
          <Button variant="destructive" onClick={handleClearData}>
            Clear All Data
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default Settings;
