import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';

interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  stats?: {
    total_deliveries: number;
    failed_deliveries: number;
  };
}

interface RecentDelivery {
  id: string;
  event_type: string;
  event_id: string;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  attempts: number;
  response_status: number | null;
  response_time_ms: number | null;
  created_at: string;
  delivered_at: string | null;
  last_error: string | null;
}

const AVAILABLE_EVENTS = [
  { value: '*', label: 'All Events', description: 'Receive all event types' },
  { value: 'vehicle.created', label: 'vehicle.created', description: 'When a new vehicle is added' },
  { value: 'vehicle.updated', label: 'vehicle.updated', description: 'When vehicle details change' },
  { value: 'vehicle.deleted', label: 'vehicle.deleted', description: 'When a vehicle is archived' },
  { value: 'observation.created', label: 'observation.created', description: 'When new data is recorded' },
  { value: 'document.uploaded', label: 'document.uploaded', description: 'When a document is uploaded' },
  { value: 'import.completed', label: 'import.completed', description: 'When a batch import finishes' },
];

export default function WebhooksPage() {
  const { session } = useAuth();
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState<string | null>(null);
  const [newWebhookSecret, setNewWebhookSecret] = useState<string | null>(null);

  // Create form state
  const [newUrl, setNewUrl] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newEvents, setNewEvents] = useState<string[]>(['*']);
  const [creating, setCreating] = useState(false);

  // Detail modal state
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookEndpoint | null>(null);
  const [recentDeliveries, setRecentDeliveries] = useState<RecentDelivery[]>([]);

  useEffect(() => {
    if (session?.access_token) {
      loadWebhooks();
    }
  }, [session]);

  async function loadWebhooks() {
    setLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhooks-manage`,
        {
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to load webhooks');
      }

      const data = await response.json();
      setWebhooks(data.data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadWebhookDetail(webhookId: string) {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhooks-manage/${webhookId}`,
        {
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to load webhook details');
      }

      const data = await response.json();
      setSelectedWebhook(data.data);
      setRecentDeliveries(data.data.recent_deliveries || []);
      setShowDetailModal(webhookId);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function createWebhook() {
    if (!newUrl.trim()) {
      setError('URL is required');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhooks-manage`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: newUrl,
            description: newDescription || undefined,
            events: newEvents,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create webhook');
      }

      // Show the secret
      setNewWebhookSecret(data.data.secret);
      setWebhooks([data.data, ...webhooks]);

      // Reset form
      setNewUrl('');
      setNewDescription('');
      setNewEvents(['*']);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function toggleWebhook(webhookId: string, isActive: boolean) {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhooks-manage/${webhookId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ is_active: !isActive }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update webhook');
      }

      setWebhooks(webhooks.map(w =>
        w.id === webhookId ? { ...w, is_active: !isActive } : w
      ));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function deleteWebhook(webhookId: string) {
    if (!confirm('Are you sure you want to delete this webhook endpoint?')) {
      return;
    }

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhooks-manage/${webhookId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete webhook');
      }

      setWebhooks(webhooks.filter(w => w.id !== webhookId));
      setShowDetailModal(null);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function rotateSecret(webhookId: string) {
    if (!confirm('This will invalidate the current secret. Continue?')) {
      return;
    }

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhooks-manage/${webhookId}/rotate-secret`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to rotate secret');
      }

      setNewWebhookSecret(data.data.secret);
    } catch (err: any) {
      setError(err.message);
    }
  }

  function handleEventToggle(event: string) {
    if (event === '*') {
      setNewEvents(['*']);
    } else {
      let updated = newEvents.filter(e => e !== '*');
      if (updated.includes(event)) {
        updated = updated.filter(e => e !== event);
      } else {
        updated.push(event);
      }
      if (updated.length === 0) {
        updated = ['*'];
      }
      setNewEvents(updated);
    }
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'success': return 'text-green-600 bg-green-50';
      case 'failed': return 'text-red-600 bg-red-50';
      case 'retrying': return 'text-yellow-600 bg-yellow-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[1, 2].map(i => (
              <div key={i} className="h-24 bg-gray-100 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Webhooks</h1>
          <p className="text-gray-600 mt-1">
            Receive real-time notifications when events occur in your account.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Add Endpoint
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Webhooks List */}
      {webhooks.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <div className="text-4xl mb-4">🔔</div>
          <h3 className="text-lg font-medium text-gray-900">No webhook endpoints</h3>
          <p className="text-gray-500 mt-1">Create an endpoint to start receiving events.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Add First Endpoint
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map(webhook => (
            <div
              key={webhook.id}
              className="border rounded-lg p-4 hover:border-gray-300 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-gray-100 px-2 py-1 rounded truncate max-w-md">
                      {webhook.url}
                    </code>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      webhook.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {webhook.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                  {webhook.description && (
                    <p className="text-sm text-gray-500 mt-1">{webhook.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {webhook.events.map(event => (
                      <span key={event} className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                        {event}
                      </span>
                    ))}
                  </div>
                  {webhook.stats && (
                    <p className="text-xs text-gray-400 mt-2">
                      {webhook.stats.total_deliveries} deliveries
                      {webhook.stats.failed_deliveries > 0 && (
                        <span className="text-red-500">
                          {' '}({webhook.stats.failed_deliveries} failed)
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => loadWebhookDetail(webhook.id)}
                    className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
                  >
                    Details
                  </button>
                  <button
                    onClick={() => toggleWebhook(webhook.id, webhook.is_active)}
                    className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
                  >
                    {webhook.is_active ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Add Webhook Endpoint</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Endpoint URL *
                </label>
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://your-server.com/webhooks"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Must be HTTPS (HTTP allowed for localhost only)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Production webhook handler"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Events to Listen For
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto border rounded-lg p-3">
                  {AVAILABLE_EVENTS.map(event => (
                    <label key={event.value} className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newEvents.includes(event.value) || (event.value !== '*' && newEvents.includes('*'))}
                        onChange={() => handleEventToggle(event.value)}
                        disabled={event.value !== '*' && newEvents.includes('*')}
                        className="mt-1"
                      />
                      <div>
                        <span className="font-mono text-sm">{event.label}</span>
                        <p className="text-xs text-gray-500">{event.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewUrl('');
                  setNewDescription('');
                  setNewEvents(['*']);
                }}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={createWebhook}
                disabled={creating || !newUrl.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create Endpoint'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Secret Display Modal */}
      {newWebhookSecret && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <h2 className="text-xl font-bold mb-4">Webhook Secret Created</h2>
            <p className="text-gray-600 mb-4">
              Save this secret now. You won't be able to see it again.
            </p>
            <div className="relative">
              <code className="block p-4 bg-gray-100 rounded-lg font-mono text-sm break-all">
                {newWebhookSecret}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(newWebhookSecret);
                }}
                className="absolute top-2 right-2 px-2 py-1 text-xs bg-white border rounded hover:bg-gray-50"
              >
                Copy
              </button>
            </div>
            <p className="text-sm text-gray-500 mt-4">
              Use this secret to verify webhook signatures. Each payload includes a{' '}
              <code className="bg-gray-100 px-1 rounded">Nuke-Signature</code> header.
            </p>
            <div className="flex justify-end mt-6">
              <button
                onClick={() => {
                  setNewWebhookSecret(null);
                  setShowCreateModal(false);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedWebhook && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold">Endpoint Details</h2>
              <button
                onClick={() => setShowDetailModal(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-500">URL</label>
                <code className="block mt-1 p-2 bg-gray-100 rounded text-sm break-all">
                  {selectedWebhook.url}
                </code>
              </div>

              {selectedWebhook.description && (
                <div>
                  <label className="text-sm text-gray-500">Description</label>
                  <p className="mt-1">{selectedWebhook.description}</p>
                </div>
              )}

              <div>
                <label className="text-sm text-gray-500">Events</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedWebhook.events.map(event => (
                    <span key={event} className="text-sm bg-gray-100 px-2 py-1 rounded">
                      {event}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-500">Status</label>
                <p className="mt-1">
                  <span className={`px-2 py-1 rounded text-sm ${
                    selectedWebhook.is_active
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {selectedWebhook.is_active ? 'Active' : 'Disabled'}
                  </span>
                </p>
              </div>

              <div className="border-t pt-4">
                <h3 className="font-medium mb-3">Recent Deliveries</h3>
                {recentDeliveries.length === 0 ? (
                  <p className="text-gray-500 text-sm">No deliveries yet</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {recentDeliveries.map(delivery => (
                      <div key={delivery.id} className="border rounded p-3 text-sm">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-mono">{delivery.event_type}</span>
                            <span className={`ml-2 px-2 py-0.5 rounded text-xs ${getStatusColor(delivery.status)}`}>
                              {delivery.status}
                            </span>
                          </div>
                          <span className="text-gray-400 text-xs">
                            {new Date(delivery.created_at).toLocaleString()}
                          </span>
                        </div>
                        {delivery.response_status && (
                          <p className="text-gray-500 mt-1">
                            HTTP {delivery.response_status}
                            {delivery.response_time_ms && ` • ${delivery.response_time_ms}ms`}
                          </p>
                        )}
                        {delivery.last_error && (
                          <p className="text-red-600 text-xs mt-1">{delivery.last_error}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t pt-4 flex justify-between">
                <div className="space-x-2">
                  <button
                    onClick={() => rotateSecret(selectedWebhook.id)}
                    className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
                  >
                    Rotate Secret
                  </button>
                  <button
                    onClick={() => deleteWebhook(selectedWebhook.id)}
                    className="px-3 py-1 text-sm border border-red-200 text-red-600 rounded hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
                <button
                  onClick={() => setShowDetailModal(null)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
