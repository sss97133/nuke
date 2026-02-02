import React, { useState, useEffect } from 'react';
import { DynamicFieldService, type FieldAuditTrail } from '../services/dynamicFieldService';

interface FieldAuditTrailProps {
  vehicleId: string;
  fieldName: string;
  isOpen: boolean;
  onClose: () => void;
}

const FieldAuditTrail: React.FC<FieldAuditTrailProps> = ({
  vehicleId,
  fieldName,
  isOpen,
  onClose
}) => {
  const [auditTrail, setAuditTrail] = useState<FieldAuditTrail[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && vehicleId && fieldName) {
      loadAuditTrail();
    }
  }, [isOpen, vehicleId, fieldName]);

  const loadAuditTrail = async () => {
    try {
      setLoading(true);
      const trail = await DynamicFieldService.getFieldAuditTrail(vehicleId, fieldName);
      setAuditTrail(trail);
    } catch (error) {
      console.error('Error loading audit trail:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSourceTypeIcon = (sourceType: string) => {
    switch (sourceType) {
      case 'human_input': return '👤';
      case 'ai_scan': return 'AI';
      case 'ai_extraction': return '📄';
      case 'ocr': return 'OCR';
      default: return '❓';
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return '#22c55e'; // Green
    if (confidence >= 0.7) return '#eab308'; // Yellow
    return '#ef4444'; // Red
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Data Source Audit: {fieldName}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Loading audit trail...</p>
          </div>
        ) : auditTrail.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            No audit trail found for this field
          </div>
        ) : (
          <div className="space-y-4">
            {auditTrail.map((entry, index) => (
              <div
                key={index}
                className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 bg-gray-50 dark:bg-gray-700"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-xl">{getSourceTypeIcon(entry.source_type)}</span>
                    <span className="font-medium capitalize text-gray-900 dark:text-white">
                      {entry.source_type.replace('_', ' ')}
                    </span>
                    {entry.verification_status && (
                      <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">
                        ✓ Verified
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <span
                      className="px-2 py-1 rounded text-xs text-white font-medium"
                      style={{ backgroundColor: getConfidenceColor(entry.confidence) }}
                    >
                      {Math.round(entry.confidence * 100)}% confidence
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(entry.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Source URL */}
                {entry.source_url && (
                  <div className="mb-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 dark:text-gray-300">Source URL:</span>
                    <a
                      href={entry.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-sm ml-2"
                    >
                      {entry.source_url}
                    </a>
                  </div>
                )}

                {/* Source Image */}
                {entry.source_image_url && (
                  <div className="mb-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Source Image:</span>
                    <div className="mt-1">
                      <img
                        src={entry.source_image_url}
                        alt="Source document"
                        className="max-w-xs max-h-32 object-contain border rounded"
                      />
                    </div>
                  </div>
                )}

                {/* Extraction Method */}
                {entry.extraction_method && (
                  <div className="mb-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Method:</span>
                    <span className="text-sm ml-2 capitalize text-gray-900 dark:text-gray-200">
                      {entry.extraction_method.replace('_', ' ')}
                    </span>
                  </div>
                )}

                {/* Raw Text */}
                {entry.raw_text && (
                  <div className="mb-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Raw Extracted Text:</span>
                    <div className="mt-1 p-2 bg-gray-100 dark:bg-gray-600 rounded text-sm font-mono text-gray-900 dark:text-gray-200">
                      {entry.raw_text}
                    </div>
                  </div>
                )}

                {/* AI Reasoning */}
                {entry.ai_reasoning && (
                  <div className="mb-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">AI Analysis:</span>
                    <div className="mt-1 p-2 bg-blue-50 dark:bg-blue-900/30 rounded text-sm text-gray-900 dark:text-gray-200">
                      {entry.ai_reasoning}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            This audit trail shows all sources and methods used to determine this field's value.
            Human verification indicates the data has been manually confirmed as accurate.
          </p>
        </div>
      </div>
    </div>
  );
};

export default FieldAuditTrail;
