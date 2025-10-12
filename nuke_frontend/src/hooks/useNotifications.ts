import { useState, useEffect } from 'react';
import { NotificationService, type Notification } from '../services/notificationService';
import { supabase } from '../lib/supabase';

interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markAsRead: (id: string) => Promise<void>;
  respondToNotification: (id: string, responseData: any) => Promise<void>;
  refresh: () => Promise<void>;
}

export const useNotifications = (userId: string | null): UseNotificationsReturn => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const loadNotifications = async () => {
    if (!userId) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await NotificationService.getUserNotifications(userId);
      setNotifications(data);
    } catch (error) {
      console.error('Error loading notifications:', error);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id: string) => {
    try {
      await NotificationService.markNotificationRead(id);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, is_read: true } : n)
      );
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw error;
    }
  };

  const respondToNotification = async (id: string, responseData: any) => {
    try {
      await NotificationService.respondToNotification(id, responseData);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, is_responded: true, is_read: true } : n)
      );
    } catch (error) {
      console.error('Error responding to notification:', error);
      throw error;
    }
  };

  useEffect(() => {
    loadNotifications();

    if (!userId) return;

    // Subscribe to real-time notifications
    const subscription = NotificationService.subscribeToNotifications(userId, (newNotification) => {
      setNotifications(prev => [newNotification, ...prev]);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [userId]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    respondToNotification,
    refresh: loadNotifications
  };
};
