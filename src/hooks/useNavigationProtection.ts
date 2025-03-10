import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useBeforeUnload } from 'react-router-dom';

interface UseNavigationProtectionProps {
  shouldPreventNavigation: boolean;
  onSave?: () => void;
}

/**
 * A custom hook that provides navigation protection for forms or pages with unsaved changes.
 * It shows a confirmation dialog when the user tries to navigate away from the page.
 */
export function useNavigationProtection({
  shouldPreventNavigation,
  onSave,
}: UseNavigationProtectionProps) {
  const navigate = useNavigate();
  const [showExitDialog, setShowExitDialog] = useState(false);
  const [intendedDestination, setIntendedDestination] = useState<number | string | null>(null);

  // Handle browser back/forward navigation
  useBeforeUnload(
    useCallback(
      (event) => {
        if (shouldPreventNavigation) {
          event.preventDefault();
          return "You have unsaved changes. Are you sure you want to leave?";
        }
      },
      [shouldPreventNavigation]
    )
  );

  // Handle history navigation
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (shouldPreventNavigation) {
        e.preventDefault();
        e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [shouldPreventNavigation]);

  // Handle navigation within the app
  const handleNavigation = useCallback(
    (to: number | string) => {
      if (shouldPreventNavigation) {
        setIntendedDestination(to);
        setShowExitDialog(true);
      } else {
        if (typeof to === 'number') {
          navigate(to);
        } else {
          navigate(to);
        }
      }
    },
    [navigate, shouldPreventNavigation]
  );

  // Confirm navigation
  const confirmNavigation = useCallback(() => {
    setShowExitDialog(false);
    if (intendedDestination !== null) {
      if (typeof intendedDestination === 'number') {
        navigate(intendedDestination);
      } else {
        navigate(intendedDestination);
      }
    }
  }, [intendedDestination, navigate]);

  // Cancel navigation
  const cancelNavigation = useCallback(() => {
    setShowExitDialog(false);
    setIntendedDestination(null);
  }, []);

  // Save and navigate
  const saveAndNavigate = useCallback(() => {
    if (onSave) {
      onSave();
    }
    setShowExitDialog(false);
    if (intendedDestination !== null) {
      if (typeof intendedDestination === 'number') {
        navigate(intendedDestination);
      } else {
        navigate(intendedDestination);
      }
    }
  }, [intendedDestination, navigate, onSave]);

  return {
    showExitDialog,
    setShowExitDialog,
    handleNavigation,
    confirmNavigation,
    cancelNavigation,
    saveAndNavigate,
  };
} 