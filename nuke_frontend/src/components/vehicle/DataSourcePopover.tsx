import React, { useEffect, useRef } from 'react';
import type { FieldAnnotation, DataSource } from '../../types/dataSource';

interface DataSourcePopoverProps {
  annotation: FieldAnnotation;
  position: { x: number; y: number };
  onClose: () => void;
}

const DataSourcePopover: React.FC<DataSourcePopoverProps> = ({
  annotation,
  position,
  onClose
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const formatSourceType = (sourceType: string): string => {
    return sourceType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getConfidenceColor = (score: number): string => {
    if (score >= 0.8) return '#22c55e'; // green
    if (score >= 0.6) return '#eab308'; // yellow
    return '#ef4444'; // red
  };

  const formatTimestamp = (timestamp: string): string => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderSource = (source: DataSource, isPrimary: boolean = false) => (
    <div key={source.id} className={`source-item ${isPrimary ? 'primary-source' : ''}`}>
      <div className="source-header">
        <div className="source-type">
          {formatSourceType(source.source_type)}
          {isPrimary && <span className="primary-badge">Primary</span>}
        </div>
        <div 
          className="confidence-score"
          style={{ color: getConfidenceColor(source.confidence_score) }}
        >
          {Math.round(source.confidence_score * 100)}%
        </div>
      </div>
      
      {source.source_entity && (
        <div className="source-entity">{source.source_entity}</div>
      )}
      
      {source.source_url && (
        <div className="source-url">
          <a href={source.source_url} target="_blank" rel="noopener noreferrer">
            View Source
          </a>
        </div>
      )}
      
      <div className="source-meta">
        <span className="verification-status">
          {source.verification_status.replace(/_/g, ' ')}
        </span>
        <span className="timestamp">
          {formatTimestamp(source.created_at)}
        </span>
      </div>
    </div>
  );

  return (
    <div className="data-source-popover-overlay">
      <div
        ref={popoverRef}
        className="data-source-popover"
        style={{
          left: position.x,
          top: position.y,
          transform: 'translateX(-50%)'
        }}
      >
        <div className="popover-header">
          <h3>Data Sources for {annotation.fieldName}</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="popover-content">
          {annotation.primarySource && (
            <div className="primary-source-section">
              <h4>Primary Source</h4>
              {renderSource(annotation.primarySource, true)}
            </div>
          )}
          
          {annotation.sources.length > 1 && (
            <div className="all-sources-section">
              <h4>All Sources ({annotation.sources.length})</h4>
              <div className="sources-list">
                {annotation.sources.map(source => renderSource(source))}
              </div>
            </div>
          )}
          
          {annotation.conflictingSources && annotation.conflictingSources.length > 0 && (
            <div className="conflicting-sources-section">
              <h4>Conflicting Data</h4>
              <div className="sources-list">
                {annotation.conflictingSources.map(source => renderSource(source))}
              </div>
            </div>
          )}
          
          <div className="verification-summary">
            <div className="verification-level">
              Verification Level: <strong>{annotation.verificationLevel}</strong>
            </div>
            <div className="last-updated">
              Last Updated: {formatTimestamp(annotation.lastUpdated)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataSourcePopover;
