
import { usePreferencesBase } from "./use-preferences-base";
import { usePreferencesSave } from "./use-preferences-save";
import { usePreferencesData } from "./use-preferences-data";
import { useAuth } from "@/hooks/use-auth";

export const usePreferences = () => {
  const { preferences, loading, error } = usePreferencesBase();
  const { savePreferences } = usePreferencesSave();
  const { handleResetPreferences, handleClearData } = usePreferencesData();
  const { user } = useAuth();

  return {
    preferences,
    loading,
    error,
    savePreferences: (updates: any) => savePreferences({ updates, user }),
    handleResetPreferences: () => handleResetPreferences({ user }),
    handleClearData: () => handleClearData({ user })
  };
};
