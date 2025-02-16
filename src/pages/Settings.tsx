
import { Card } from "@/components/ui/card";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { AutoSaveSettings } from "@/components/settings/AutoSaveSettings";
import { DataManagement } from "@/components/settings/DataManagement";
import { AlertSettings } from "@/components/settings/AlertSettings";
import { DisplaySettings } from "@/components/settings/DisplaySettings";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { usePreferences } from "@/hooks/use-preferences";
import { ErrorBoundary } from "@/components/error-boundary/ErrorBoundary";

export const Settings = () => {
  const {
    preferences,
    loading,
    error,
    savePreferences,
    handleResetPreferences,
    handleClearData
  } = usePreferences();

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
      
      <Card className="p-6 space-y-6">
        <ErrorBoundary>
          <AppearanceSettings
            compactViewEnabled={preferences.compactViewEnabled}
            onCompactViewChange={(checked) => {
              savePreferences({ compact_view_enabled: checked });
            }}
          />
        </ErrorBoundary>

        <ErrorBoundary>
          <DisplaySettings
            distanceUnit={preferences.distanceUnit}
            currency={preferences.currency}
            defaultGarageView={preferences.defaultGarageView}
            onDistanceUnitChange={(value) => {
              savePreferences({ distance_unit: value });
            }}
            onCurrencyChange={(value) => {
              savePreferences({ currency: value });
            }}
            onDefaultGarageViewChange={(value) => {
              savePreferences({ default_garage_view: value });
            }}
          />
        </ErrorBoundary>

        <ErrorBoundary>
          <NotificationSettings
            notificationsEnabled={preferences.notificationsEnabled}
            onNotificationsChange={(checked) => {
              savePreferences({ notifications_enabled: checked });
            }}
          />
        </ErrorBoundary>

        <ErrorBoundary>
          <AlertSettings
            serviceRemindersEnabled={preferences.serviceRemindersEnabled}
            inventoryAlertsEnabled={preferences.inventoryAlertsEnabled}
            priceAlertsEnabled={preferences.priceAlertsEnabled}
            onServiceRemindersChange={(checked) => {
              savePreferences({ service_reminders_enabled: checked });
            }}
            onInventoryAlertsChange={(checked) => {
              savePreferences({ inventory_alerts_enabled: checked });
            }}
            onPriceAlertsChange={(checked) => {
              savePreferences({ price_alerts_enabled: checked });
            }}
          />
        </ErrorBoundary>

        <ErrorBoundary>
          <AutoSaveSettings
            autoSaveEnabled={preferences.autoSaveEnabled}
            onAutoSaveChange={(checked) => {
              savePreferences({ auto_save_enabled: checked });
            }}
          />
        </ErrorBoundary>
      </Card>

      <Card className="p-6">
        <ErrorBoundary>
          <DataManagement
            onResetPreferences={handleResetPreferences}
            onClearData={handleClearData}
          />
        </ErrorBoundary>
      </Card>
    </div>
  );
};

export default Settings;
