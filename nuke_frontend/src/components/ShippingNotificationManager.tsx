import React, { useState, useEffect } from 'react';
import {
  BellIcon,
  PhoneIcon,
  EnvelopeIcon,
  UserPlusIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';

interface NotificationRecipient {
  id?: string;
  shipping_task_id: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_email: string;
  notification_method: 'sms' | 'email' | 'both';
  is_active: boolean;
  is_buyer: boolean;
  last_notified?: string;
}

interface ShippingNotificationManagerProps {
  taskId: string;
  taskTitle: string;
  isOwner: boolean;
}

const ShippingNotificationManager: React.FC<ShippingNotificationManagerProps> = ({ 
  taskId, 
  taskTitle,
  isOwner 
}) => {
  const [recipients, setRecipients] = useState<NotificationRecipient[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [sendingNotification, setSendingNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRecipients();
  }, [taskId]);

  const loadRecipients = async () => {
    try {
      const { data, error } = await supabase
        .from('shipping_notifications')
        .select('*')
        .eq('shipping_task_id', taskId)
        .order('is_buyer', { ascending: false });

      if (error) throw error;
      setRecipients(data || []);
    } catch (error) {
      console.error('Error loading recipients:', error);
    } finally {
      setLoading(false);
    }
  };

  const AddRecipientForm: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [formData, setFormData] = useState({
      recipient_name: '',
      recipient_phone: '',
      recipient_email: '',
      notification_method: 'sms' as const,
      is_buyer: false
    });

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        const { error } = await supabase
          .from('shipping_notifications')
          .insert([{
            ...formData,
            shipping_task_id: taskId,
            is_active: true
          }]);

        if (error) throw error;
        await loadRecipients();
        onClose();
      } catch (error) {
        console.error('Error adding recipient:', error);
      }
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Add Notification Recipient</h3>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Recipient Name
              </label>
              <input
                type="text"
                value={formData.recipient_name}
                onChange={(e) => setFormData(prev => ({ ...prev, recipient_name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                value={formData.recipient_phone}
                onChange={(e) => setFormData(prev => ({ ...prev, recipient_phone: e.target.value }))}
                placeholder="+1234567890"
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={formData.recipient_email}
                onChange={(e) => setFormData(prev => ({ ...prev, recipient_email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notification Method
              </label>
              <select
                value={formData.notification_method}
                onChange={(e) => setFormData(prev => ({ ...prev, notification_method: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="sms">SMS Only</option>
                <option value="email">Email Only</option>
                <option value="both">SMS & Email</option>
              </select>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_buyer"
                checked={formData.is_buyer}
                onChange={(e) => setFormData(prev => ({ ...prev, is_buyer: e.target.checked }))}
                className="mr-2"
              />
              <label htmlFor="is_buyer" className="text-sm text-gray-700">
                This is the vehicle buyer
              </label>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Add Recipient
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  const sendCustomNotification = async () => {
    if (!notificationMessage.trim()) return;
    
    setSendingNotification(true);
    try {
      // Send notification via API
      const { data, error } = await supabase.functions.invoke('send-shipping-notification', {
        body: {
          taskId,
          message: notificationMessage,
          recipients: recipients.filter(r => r.is_active)
        }
      });

      if (error) throw error;
      
      // Log the notification
      for (const recipient of recipients.filter(r => r.is_active)) {
        await supabase
          .from('shipping_notification_logs')
          .insert([{
            shipping_task_id: taskId,
            recipient_id: recipient.id,
            notification_type: 'manual_update',
            message: notificationMessage,
            status: 'sent'
          }]);
      }
      
      setNotificationMessage('');
      alert('Notifications sent successfully!');
    } catch (error) {
      console.error('Error sending notifications:', error);
      alert('Failed to send notifications');
    } finally {
      setSendingNotification(false);
    }
  };

  const toggleRecipientStatus = async (recipientId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('shipping_notifications')
        .update({ is_active: !currentStatus })
        .eq('id', recipientId);

      if (error) throw error;
      await loadRecipients();
    } catch (error) {
      console.error('Error toggling recipient status:', error);
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-center">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 rounded-lg p-4 mt-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <BellIcon className="w-5 h-5 text-blue-600" />
          <h4 className="font-medium">Shipping Notifications</h4>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowAddForm(true)}
            className="button button-small"
          >
            <UserPlusIcon className="w-4 h-4 mr-1" />
            Add Recipient
          </button>
        )}
      </div>

      {/* Recipients List */}
      {recipients.length === 0 ? (
        <p className="text-sm text-gray-500">No notification recipients configured</p>
      ) : (
        <div className="space-y-2 mb-4">
          {recipients.map((recipient) => (
            <div 
              key={recipient.id} 
              className={`flex items-center justify-between p-2 bg-white rounded border ${
                recipient.is_active ? 'border-gray-200' : 'border-gray-100 opacity-50'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className={`p-1 rounded ${recipient.is_buyer ? 'bg-blue-100' : 'bg-gray-100'}`}>
                  {recipient.notification_method === 'sms' || recipient.notification_method === 'both' ? (
                    <PhoneIcon className="w-4 h-4 text-gray-600" />
                  ) : (
                    <EnvelopeIcon className="w-4 h-4 text-gray-600" />
                  )}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">{recipient.recipient_name}</span>
                    {recipient.is_buyer && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Buyer</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {recipient.recipient_phone}
                    {recipient.recipient_email && ` • ${recipient.recipient_email}`}
                  </div>
                </div>
              </div>
              
              {isOwner && (
                <button
                  onClick={() => toggleRecipientStatus(recipient.id!, recipient.is_active)}
                  className={`text-sm ${recipient.is_active ? 'text-green-600' : 'text-gray-400'}`}
                >
                  {recipient.is_active ? 'Active' : 'Inactive'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Send Custom Notification */}
      {isOwner && recipients.filter(r => r.is_active).length > 0 && (
        <div className="mt-4 p-3 bg-white rounded border border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Send Update to All Active Recipients
          </label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={notificationMessage}
              onChange={(e) => setNotificationMessage(e.target.value)}
              placeholder={`Update about ${taskTitle}`}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
            <button
              onClick={sendCustomNotification}
              disabled={sendingNotification || !notificationMessage.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              {sendingNotification ? 'Sending...' : 'Send'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Recipients will automatically be notified when status changes
          </p>
        </div>
      )}

      {showAddForm && (
        <AddRecipientForm onClose={() => setShowAddForm(false)} />
      )}
    </div>
  );
};

export default ShippingNotificationManager;
