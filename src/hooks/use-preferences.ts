
import { usePreferencesBase } from "./use-preferences-base";
import { usePreferencesSave } from "./use-preferences-save";
import { usePreferencesData } from "./use-preferences-data";

export const usePreferences = () => {
  const { preferences, loading, error } = usePreferencesBase();
  const { savePreferences } = usePreferencesSave();
  const { handleResetPreferences, handleClearData } = usePreferencesData();

  return {
    preferences,
    loading,
    error,
    savePreferences,
    handleResetPreferences,
    handleClearData
  };
};
