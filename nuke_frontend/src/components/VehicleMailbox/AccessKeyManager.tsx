import React, { useState, useEffect } from 'react'
import { Plus, Trash2, Key, Clock, User, Building } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { formatDistanceToNow } from 'date-fns'
import { supabase } from '../../lib/supabase'

interface AccessKey {
  id: string
  key_type: string
  permission_level: string
  relationship_type: string
  user_id?: string
  org_id?: string
  expires_at?: string
  granted_by: string
  created_at: string
  user?: {
    id: string
    name: string
    email: string
  }
  org?: {
    id: string
    name: string
  }
}

interface AccessKeyManagerProps {
  vehicleId: string
}

const AccessKeyManager: React.FC<AccessKeyManagerProps> = ({ vehicleId }) => {
  const [accessKeys, setAccessKeys] = useState<AccessKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showGrantForm, setShowGrantForm] = useState(false)
  const [grantForm, setGrantForm] = useState({
    user_email: '',
    org_id: '',
    key_type: 'temporary',
    permission_level: 'read_only',
    relationship_type: 'trusted_party',
    expires_in_days: '30'
  })

  useEffect(() => {
    loadAccessKeys()
  }, [vehicleId])

  const getAuthHeaders = async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token || localStorage.getItem('auth_token')
    return token ? { 'Authorization': `Bearer ${token}` } : {}
  }

  const loadAccessKeys = async () => {
    setLoading(true)
    try {
      const authHeaders = await getAuthHeaders()
      const response = await fetch(`/api/vehicles/${vehicleId}/mailbox/access`, {
        headers: {
          ...authHeaders
        }
      })

      if (response.ok) {
        const result = await response.json()
        setAccessKeys(result.data)
      } else {
        toast.error('Failed to load access keys')
      }
    } catch (error) {
      console.error('Error loading access keys:', error)
      toast.error('Error loading access keys')
    } finally {
      setLoading(false)
    }
  }

  const grantAccess = async () => {
    try {
      const payload: any = {
        key_type: grantForm.key_type,
        permission_level: grantForm.permission_level,
        relationship_type: grantForm.relationship_type
      }

      // Add user_id or org_id based on form
      if (grantForm.user_email) {
        // In a real implementation, you'd look up user by email
        payload.user_email = grantForm.user_email
      } else if (grantForm.org_id) {
        payload.org_id = grantForm.org_id
      }

      // Add expiration if specified
      if (grantForm.expires_in_days) {
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + parseInt(grantForm.expires_in_days))
        payload.expires_at = expiresAt.toISOString()
      }

      const authHeaders = await getAuthHeaders()
      const response = await fetch(`/api/vehicles/${vehicleId}/mailbox/access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        toast.success('Access granted successfully')
        setShowGrantForm(false)
        setGrantForm({
          user_email: '',
          org_id: '',
          key_type: 'temporary',
          permission_level: 'read_only',
          relationship_type: 'trusted_party',
          expires_in_days: '30'
        })
        loadAccessKeys()
      } else {
        const error = await response.json()
        toast.error(error.message || 'Failed to grant access')
      }
    } catch (error) {
      console.error('Error granting access:', error)
      toast.error('Error granting access')
    }
  }

  const revokeAccess = async (accessKeyId: string) => {
    if (!confirm('Are you sure you want to revoke this access?')) return

    try {
      const authHeaders = await getAuthHeaders()
      const response = await fetch(`/api/vehicles/${vehicleId}/mailbox/access/${accessKeyId}`, {
        method: 'DELETE',
        headers: {
          ...authHeaders
        }
      })

      if (response.ok) {
        toast.success('Access revoked successfully')
        loadAccessKeys()
      } else {
        toast.error('Failed to revoke access')
      }
    } catch (error) {
      console.error('Error revoking access:', error)
      toast.error('Error revoking access')
    }
  }

  const getKeyTypeIcon = (keyType: string) => {
    switch (keyType) {
      case 'master':
        return <Key className="w-5 h-5 text-gold-500" />
      case 'temporary':
        return <Clock className="w-5 h-5 text-blue-500" />
      default:
        return <Key className="w-5 h-5 text-gray-500" />
    }
  }

  const getKeyTypeBadge = (keyType: string) => {
    const colors = {
      master: 'bg-yellow-100 text-yellow-800',
      temporary: 'bg-blue-100 text-blue-800',
      conditional: 'bg-purple-100 text-purple-800',
      inherited: 'bg-green-100 text-green-800',
      system: 'bg-gray-100 text-gray-800'
    }

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[keyType] || colors.system}`}>
        {keyType}
      </span>
    )
  }

  const getPermissionBadge = (permission: string) => {
    const colors = {
      read_write: 'bg-red-100 text-red-800',
      read_only: 'bg-green-100 text-green-800',
      write_only: 'bg-orange-100 text-orange-800',
      filtered: 'bg-gray-100 text-gray-800'
    }

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[permission] || colors.filtered}`}>
        {permission.replace('_', ' ')}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-300 rounded w-1/3"></div>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-300 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium text-gray-900">Access Keys</h3>
        <button
          onClick={() => setShowGrantForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>Grant Access</span>
        </button>
      </div>

      {/* Grant Access Form */}
      {showGrantForm && (
        <div className="bg-gray-50 border rounded-lg p-4 mb-6">
          <h4 className="font-medium text-gray-900 mb-4">Grant New Access</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                User Email
              </label>
              <input
                type="email"
                value={grantForm.user_email}
                onChange={(e) => setGrantForm(prev => ({ ...prev, user_email: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Relationship Type
              </label>
              <select
                value={grantForm.relationship_type}
                onChange={(e) => setGrantForm(prev => ({ ...prev, relationship_type: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="trusted_party">Trusted Party</option>
                <option value="family">Family</option>
                <option value="service_provider">Service Provider</option>
                <option value="insurance">Insurance</option>
                <option value="dealer">Dealer</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Permission Level
              </label>
              <select
                value={grantForm.permission_level}
                onChange={(e) => setGrantForm(prev => ({ ...prev, permission_level: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="read_only">Read Only</option>
                <option value="read_write">Read/Write</option>
                <option value="write_only">Write Only</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Expires in (days)
              </label>
              <input
                type="number"
                value={grantForm.expires_in_days}
                onChange={(e) => setGrantForm(prev => ({ ...prev, expires_in_days: e.target.value }))}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                placeholder="30"
              />
            </div>
          </div>
          <div className="flex justify-end space-x-3 mt-4">
            <button
              onClick={() => setShowGrantForm(false)}
              className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300"
            >
              Cancel
            </button>
            <button
              onClick={grantAccess}
              className="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700"
            >
              Grant Access
            </button>
          </div>
        </div>
      )}

      {/* Access Keys List */}
      <div className="space-y-4">
        {accessKeys.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <Key className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No access keys granted yet.</p>
          </div>
        ) : (
          accessKeys.map((accessKey) => (
            <div key={accessKey.id} className="border rounded-lg p-4 hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  {getKeyTypeIcon(accessKey.key_type)}
                  <div>
                    <div className="flex items-center space-x-2">
                      {accessKey.user ? (
                        <div className="flex items-center space-x-1">
                          <User className="w-4 h-4 text-gray-500" />
                          <span className="font-medium">{accessKey.user.name}</span>
                          <span className="text-sm text-gray-500">({accessKey.user.email})</span>
                        </div>
                      ) : accessKey.org ? (
                        <div className="flex items-center space-x-1">
                          <Building className="w-4 h-4 text-gray-500" />
                          <span className="font-medium">{accessKey.org.name}</span>
                        </div>
                      ) : (
                        <span className="text-gray-500">Unknown recipient</span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 mt-1">
                      {getKeyTypeBadge(accessKey.key_type)}
                      {getPermissionBadge(accessKey.permission_level)}
                      <span className="text-xs text-gray-500">
                        {accessKey.relationship_type.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="text-right text-sm text-gray-500">
                    <div>Granted {formatDistanceToNow(new Date(accessKey.created_at), { addSuffix: true })}</div>
                    {accessKey.expires_at && (
                      <div>Expires {formatDistanceToNow(new Date(accessKey.expires_at), { addSuffix: true })}</div>
                    )}
                  </div>
                  {accessKey.key_type !== 'master' && (
                    <button
                      onClick={() => revokeAccess(accessKey.id)}
                      className="text-red-600 hover:text-red-800 p-1"
                      title="Revoke access"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default AccessKeyManager