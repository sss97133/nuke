import React, { useState, useEffect } from 'react'
import { X, AlertTriangle, CheckCircle, XCircle, ExternalLink, MapPin, Camera, Clock } from 'lucide-react'
import { toast } from 'react-hot-toast'

interface MailboxMessage {
  id: string
  message_type: string
  title: string
  content: string
  priority: string
  metadata: Record<string, any>
}

interface DuplicateDetection {
  id: string
  original_vehicle_id: string
  duplicate_vehicle_id: string
  detection_method: string
  confidence_score: number
  evidence: Record<string, any>
  status: string
  created_at: string
  original_vehicle: {
    id: string
    vin: string
    make?: string
    model?: string
    year?: number
  }
  duplicate_vehicle: {
    id: string
    vin: string
    make?: string
    model?: string
    year?: number
  }
}

interface DuplicateDetectionModalProps {
  message: MailboxMessage
  vehicleId: string
  onConfirm: (action: 'confirm' | 'reject') => void
  onClose: () => void
}

const DuplicateDetectionModal: React.FC<DuplicateDetectionModalProps> = ({
  message,
  vehicleId,
  onConfirm,
  onClose
}) => {
  const [detection, setDetection] = useState<DuplicateDetection | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDuplicateDetails()
  }, [])

  const loadDuplicateDetails = async () => {
    try {
      const response = await fetch(`/api/vehicles/${vehicleId}/mailbox/messages/${message.id}/duplicate-details`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      })

      if (response.ok) {
        const result = await response.json()
        setDetection(result.data)
      } else {
        toast.error('Failed to load duplicate details')
      }
    } catch (error) {
      console.error('Error loading duplicate details:', error)
      toast.error('Error loading duplicate details')
    } finally {
      setLoading(false)
    }
  }

  const getDetectionMethodIcon = (method: string) => {
    switch (method) {
      case 'exif_gps':
        return <MapPin className="w-5 h-5 text-blue-500" />
      case 'image_hash':
        return <Camera className="w-5 h-5 text-green-500" />
      case 'temporal_clustering':
        return <Clock className="w-5 h-5 text-purple-500" />
      default:
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />
    }
  }

  const getDetectionMethodDescription = (method: string) => {
    switch (method) {
      case 'exif_gps':
        return 'Photos were taken at the same location and time'
      case 'image_hash':
        return 'Photos have identical perceptual fingerprints'
      case 'ai_visual':
        return 'AI detected identical visual features'
      case 'temporal_clustering':
        return 'Photos were taken in close temporal proximity'
      case 'manual_report':
        return 'Manually reported by a user'
      default:
        return 'Unknown detection method'
    }
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-red-600'
    if (confidence >= 0.7) return 'text-orange-600'
    if (confidence >= 0.5) return 'text-yellow-600'
    return 'text-gray-600'
  }

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.9) return 'Very High'
    if (confidence >= 0.7) return 'High'
    if (confidence >= 0.5) return 'Medium'
    return 'Low'
  }

  const formatEvidence = (evidence: Record<string, any>, method: string) => {
    switch (method) {
      case 'exif_gps':
        return (
          <div className="space-y-2">
            {evidence.gps_distance && (
              <div>Distance: {Math.round(evidence.gps_distance)}m apart</div>
            )}
            {evidence.time_diff && (
              <div>Time difference: {Math.abs(evidence.time_diff)} seconds</div>
            )}
          </div>
        )
      case 'image_hash':
        return (
          <div className="space-y-2">
            {evidence.hash_similarity && (
              <div>Hash similarity: {evidence.hash_similarity}</div>
            )}
            {evidence.matching_hash && (
              <div className="font-mono text-sm">
                Hash: {evidence.matching_hash.substring(0, 16)}...
              </div>
            )}
          </div>
        )
      case 'device_fingerprint':
        return (
          <div className="space-y-2">
            {evidence.device_fingerprint && (
              <div className="font-mono text-sm">
                Device: {evidence.device_fingerprint.substring(0, 16)}...
              </div>
            )}
            {evidence.time_difference_hours && (
              <div>Time difference: {Math.round(evidence.time_difference_hours)} hours</div>
            )}
          </div>
        )
      default:
        return (
          <div className="text-sm text-gray-600">
            {JSON.stringify(evidence, null, 2)}
          </div>
        )
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg p-6 max-w-2xl w-full">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-gray-300 rounded w-3/4"></div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-300 rounded"></div>
              <div className="h-4 bg-gray-300 rounded w-5/6"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!detection) {
    return (
      <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full">
          <div className="text-center">
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Failed to Load Details
            </h3>
            <p className="text-gray-600">
              Could not load duplicate detection details.
            </p>
            <button
              onClick={onClose}
              className="mt-4 bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-screen overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-6 h-6 text-yellow-500" />
            <h3 className="text-lg font-medium text-gray-900">
              Duplicate Vehicle Detection
            </h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Detection Summary */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                {getDetectionMethodIcon(detection.detection_method)}
                <div>
                  <h4 className="font-medium text-gray-900">
                    Detection Method: {detection.detection_method.replace('_', ' ').toUpperCase()}
                  </h4>
                  <p className="text-sm text-gray-600">
                    {getDetectionMethodDescription(detection.detection_method)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-2xl font-bold ${getConfidenceColor(detection.confidence_score)}`}>
                  {Math.round(detection.confidence_score * 100)}%
                </div>
                <div className="text-sm text-gray-600">
                  {getConfidenceLabel(detection.confidence_score)} Confidence
                </div>
              </div>
            </div>
          </div>

          {/* Vehicle Comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Original Vehicle */}
            <div className="border rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-3">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <h4 className="font-medium text-gray-900">Original Vehicle</h4>
              </div>
              <div className="space-y-2 text-sm">
                <div><strong>VIN:</strong> {detection.original_vehicle.vin}</div>
                {detection.original_vehicle.year && (
                  <div>
                    <strong>Vehicle:</strong> {detection.original_vehicle.year} {detection.original_vehicle.make} {detection.original_vehicle.model}
                  </div>
                )}
                <div>
                  <strong>ID:</strong>
                  <span className="font-mono text-xs ml-1">
                    {detection.original_vehicle.id}
                  </span>
                </div>
              </div>
            </div>

            {/* Duplicate Vehicle */}
            <div className="border rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-3">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <h4 className="font-medium text-gray-900">Potential Duplicate</h4>
                <a
                  href={`/vehicles/${detection.duplicate_vehicle.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              <div className="space-y-2 text-sm">
                <div><strong>VIN:</strong> {detection.duplicate_vehicle.vin}</div>
                {detection.duplicate_vehicle.year && (
                  <div>
                    <strong>Vehicle:</strong> {detection.duplicate_vehicle.year} {detection.duplicate_vehicle.make} {detection.duplicate_vehicle.model}
                  </div>
                )}
                <div>
                  <strong>ID:</strong>
                  <span className="font-mono text-xs ml-1">
                    {detection.duplicate_vehicle.id}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Evidence Details */}
          <div className="border rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">Evidence Details</h4>
            <div className="text-sm text-gray-600">
              {formatEvidence(detection.evidence, detection.detection_method)}
            </div>
          </div>

          {/* Detection Info */}
          <div className="text-xs text-gray-500">
            Detection created: {new Date(detection.created_at).toLocaleString()}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3 p-6 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm('reject')}
            className="px-4 py-2 text-white bg-gray-600 rounded hover:bg-gray-700 flex items-center space-x-2"
          >
            <XCircle className="w-4 h-4" />
            <span>Not a Duplicate</span>
          </button>
          <button
            onClick={() => onConfirm('confirm')}
            className="px-4 py-2 text-white bg-red-600 rounded hover:bg-red-700 flex items-center space-x-2"
          >
            <CheckCircle className="w-4 h-4" />
            <span>Confirm Duplicate</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default DuplicateDetectionModal