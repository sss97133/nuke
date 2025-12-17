import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { AdminNotificationService } from '../services/adminNotificationService';

type AdminAccessState = {
  loading: boolean;
  isAdmin: boolean;
  refresh: () => Promise<void>;
};

export function useAdminAccess(): AdminAccessState {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminLoading, setAdminLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setIsAdmin(false);
      setAdminLoading(false);
      return;
    }

    setAdminLoading(true);
    try {
      const ok = await AdminNotificationService.isCurrentUserAdmin();
      setIsAdmin(ok);
    } finally {
      setAdminLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    refresh();
  }, [authLoading, refresh]);

  return {
    loading: authLoading || adminLoading,
    isAdmin,
    refresh,
  };
}




