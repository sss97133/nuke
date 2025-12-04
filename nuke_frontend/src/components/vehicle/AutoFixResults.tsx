/**
 * Auto-Fix Results Component
 * Shows what profile data was automatically corrected from images
 */

import React from 'react';

interface ProfileFix {
  field: string;
  old_value: any;
  new_value: any;
  confidence: number;
  evidence: string;
  action: 'corrected' | 'added' | 'flagged_conflict';
}

interface AutoFixResultsProps {
  fixes: ProfileFix[];
  onClose?: () => void;
}

export const AutoFixResults: React.FC<AutoFixResultsProps> = ({ fixes, onClose }) => {
  const corrected = fixes.filter(f => f.action === 'corrected');
  const added = fixes.filter(f => f.action === 'added');
  const flagged = fixes.filter(f => f.action === 'flagged_conflict');

  if (fixes.length === 0) {
    return null;
  }

  const formatFieldName = (field: string) => {
    return field
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="bg-green-50 border-2 border-green-500 rounded-lg p-4 mb-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-bold text-green-900 text-lg flex items-center gap-2">
            🔧 AUTO-FIX COMPLETE
          </h3>
          <p className="text-sm text-green-700 mt-1">
            AI detected and corrected incorrect data from your images
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-green-700 hover:text-green-900"
          >
            ✕
          </button>
        )}
      </div>

      {/* Corrections */}
      {corrected.length > 0 && (
        <div className="mb-3">
          <h4 className="font-semibold text-green-800 mb-2">
            ✅ CORRECTED ({corrected.length})
          </h4>
          <div className="space-y-2">
            {corrected.map((fix, idx) => (
              <div key={idx} className="bg-white rounded p-3 border border-green-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-900">
                    {formatFieldName(fix.field)}
                  </span>
                  <span className="text-xs text-green-700 font-medium">
                    {fix.confidence}% confident
                  </span>
                </div>
                <div className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-red-600 line-through">{fix.old_value || 'Missing'}</span>
                    <span className="text-gray-400">→</span>
                    <span className="text-green-700 font-semibold">{fix.new_value}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Evidence: {fix.evidence}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Added fields */}
      {added.length > 0 && (
        <div className="mb-3">
          <h4 className="font-semibold text-blue-800 mb-2">
            ➕ ADDED ({added.length})
          </h4>
          <div className="space-y-2">
            {added.map((fix, idx) => (
              <div key={idx} className="bg-white rounded p-3 border border-blue-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-900">
                    {formatFieldName(fix.field)}
                  </span>
                  <span className="text-xs text-blue-700 font-medium">
                    {fix.confidence}% confident
                  </span>
                </div>
                <div className="text-sm">
                  <span className="text-blue-700 font-semibold">{fix.new_value}</span>
                  <div className="text-xs text-gray-500 mt-1">
                    Evidence: {fix.evidence}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Flagged conflicts */}
      {flagged.length > 0 && (
        <div>
          <h4 className="font-semibold text-yellow-800 mb-2">
            ⚠️ NEEDS REVIEW ({flagged.length})
          </h4>
          <p className="text-xs text-yellow-700 mb-2">
            Low confidence - please verify these manually
          </p>
          <div className="space-y-2">
            {flagged.map((fix, idx) => (
              <div key={idx} className="bg-white rounded p-3 border border-yellow-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-900">
                    {formatFieldName(fix.field)}
                  </span>
                  <span className="text-xs text-yellow-700 font-medium">
                    Only {fix.confidence}% confident
                  </span>
                </div>
                <div className="text-sm">
                  <div>Current: <span className="font-medium">{fix.old_value || 'Missing'}</span></div>
                  <div>Suggested: <span className="font-medium text-yellow-700">{fix.new_value}</span></div>
                  <div className="text-xs text-gray-500 mt-1">
                    Evidence: {fix.evidence}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AutoFixResults;

