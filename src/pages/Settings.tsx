
import { Card } from "@/components/ui/card";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { AutoSaveSettings } from "@/components/settings/AutoSaveSettings";
import { DataManagement } from "@/components/settings/DataManagement";
import { AlertSettings } from "@/components/settings/AlertSettings";
import { DisplaySettings } from "@/components/settings/DisplaySettings";
import { ThemeSettings } from "@/components/settings/ThemeSettings";
import { ColorSettings } from "@/components/settings/ColorSettings";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { usePreferences } from "@/hooks/use-preferences";
import { ErrorBoundary } from "@/components/error-boundary/ErrorBoundary";
import { useLocation } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffect, useState } from "react";

export const Settings = () => {
  const {
    preferences,
    loading,
    error,
    savePreferences,
    handleResetPreferences,
    handleClearData
  } = usePreferences();
  
  const location = useLocation();
  const [activeTab, setActiveTab] = useState("preferences");
  
  // Parse the URL parameters to determine which tab should be active
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    
    if (tab === "notifications" || tab === "data" || tab === "appearance") {
      setActiveTab(tab);
    } else {
      setActiveTab("preferences");
    }
  }, [location.search]);

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6 space-y-8">
        <Skeleton className="h-8 w-48" />
        <Card className="p-6 space-y-6">
          <Skeleton className="h-4 w-32" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold">System Preferences</h1>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="preferences">General</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="data">Data Management</TabsTrigger>
        </TabsList>
        
        <TabsContent value="preferences" className="mt-6">
          <Card className="p-6 space-y-6">
            <ErrorBoundary>
              <ThemeSettings
                theme={preferences.theme}
                onThemeChange={(value) => {
                  savePreferences({ theme: value });
                }}
              />
            </ErrorBoundary>

            <ErrorBoundary>
              <DisplaySettings
                distanceUnit={preferences.distanceUnit}
                currency={preferences.currency}
                defaultGarageView={preferences.defaultGarageView}
                onDistanceUnitChange={(value) => {
                  savePreferences({ distanceUnit: value });
                }}
                onCurrencyChange={(value) => {
                  savePreferences({ currency: value });
                }}
                onDefaultGarageViewChange={(value) => {
                  savePreferences({ defaultGarageView: value });
                }}
              />
            </ErrorBoundary>

            <ErrorBoundary>
              <AutoSaveSettings
                autoSaveEnabled={preferences.autoSaveEnabled}
                onAutoSaveChange={(checked) => {
                  savePreferences({ autoSaveEnabled: checked });
                }}
              />
            </ErrorBoundary>
          </Card>
        </TabsContent>
        
        <TabsContent value="appearance" className="mt-6">
          <Card className="p-6 space-y-6">
            <ErrorBoundary>
              <AppearanceSettings
                compactViewEnabled={preferences.compactViewEnabled}
                onCompactViewChange={(checked) => {
                  savePreferences({ compactViewEnabled: checked });
                }}
              />
            </ErrorBoundary>
            
            <ErrorBoundary>
              <ColorSettings
                primaryColor={preferences.primaryColor || "#9b87f5"}
                secondaryColor={preferences.secondaryColor || "#7E69AB"}
                accentColor={preferences.accentColor || "#8B5CF6"}
                onPrimaryColorChange={(value) => {
                  savePreferences({ primaryColor: value });
                }}
                onSecondaryColorChange={(value) => {
                  savePreferences({ secondaryColor: value });
                }}
                onAccentColorChange={(value) => {
                  savePreferences({ accentColor: value });
                }}
              />
            </ErrorBoundary>
          </Card>
        </TabsContent>
        
        <TabsContent value="notifications" className="mt-6">
          <Card className="p-6 space-y-6">
            <ErrorBoundary>
              <NotificationSettings
                notificationsEnabled={preferences.notificationsEnabled}
                onNotificationsChange={(checked) => {
                  savePreferences({ notificationsEnabled: checked });
                }}
              />
            </ErrorBoundary>

            <ErrorBoundary>
              <AlertSettings
                serviceRemindersEnabled={preferences.serviceRemindersEnabled}
                inventoryAlertsEnabled={preferences.inventoryAlertsEnabled}
                priceAlertsEnabled={preferences.priceAlertsEnabled}
                onServiceRemindersChange={(checked) => {
                  savePreferences({ serviceRemindersEnabled: checked });
                }}
                onInventoryAlertsChange={(checked) => {
                  savePreferences({ inventoryAlertsEnabled: checked });
                }}
                onPriceAlertsChange={(checked) => {
                  savePreferences({ priceAlertsEnabled: checked });
                }}
              />
            </ErrorBoundary>
          </Card>
        </TabsContent>
        
        <TabsContent value="data" className="mt-6">
          <Card className="p-6">
            <ErrorBoundary>
              <DataManagement
                onResetPreferences={handleResetPreferences}
                onClearData={handleClearData}
              />
            </ErrorBoundary>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Settings;
