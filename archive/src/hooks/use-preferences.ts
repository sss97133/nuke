
import { usePreferencesBase } from "./use-preferences-base";
import { usePreferencesSave } from "./use-preferences-save";
import { usePreferencesData } from "./use-preferences-data";
import { useAuth } from "@/hooks/use-auth";

export const usePreferences = () => {
  const { preferences, loading, error } = usePreferencesBase();
  const { savePreferences } = usePreferencesSave();
  const { handleResetPreferences, handleClearData } = usePreferencesData();
  const { session } = useAuth();
  
  const user = session?.user ? {
    id: session.user.id,
    email: session.user.email || ''
  } : null;

  return {
    preferences,
    loading,
    error,
    savePreferences,
    handleResetPreferences: () => handleResetPreferences({ user }),
    handleClearData: () => handleClearData({ user })
  };
};
