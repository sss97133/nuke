import React from 'react';
import './VehicleCard.css';

// Local implementation of the vehicle card component that follows vehicle-centric architecture

interface Source {
  id: string;
  name: string;
  type: 'bat' | 'nhtsa' | 'verification' | 'other';
  timestamp: Date;
  confidenceScore: number;
}

interface VehicleCardProps {
  vin: string;
  make: string;
  model: string;
  year: number;
  image?: string;
  confidenceScore?: number;
  sources?: Source[];
  lastUpdated?: Date;
  verificationStatus?: 'verified' | 'pending' | 'unverified';
  ownershipHistory?: number;
}

export const VehicleCard: React.FC<VehicleCardProps> = ({
  vin,
  make,
  model,
  year,
  image,
  confidenceScore = 0,
  sources = [],
  lastUpdated,
  verificationStatus = 'unverified',
  ownershipHistory = 0
}) => {
  // Get source-specific classes and labels
  const getSourceBadgeClass = (sourceType: string) => {
    switch(sourceType) {
      case 'bat': return 'source-bat';
      case 'nhtsa': return 'source-nhtsa';
      case 'verification': return 'source-verification';
      default: return '';
    }
  };

  return (
    <div className="vehicle-card">
      <div className="vehicle-image">
        {image ? (
          <img src={image} alt={`${year} ${make} ${model}`} />
        ) : (
          <div className="no-image">No image available</div>
        )}
        {verificationStatus === 'verified' && (
          <div className="verification-badge" title="Verified through PTZ verification center">
            <span className="verification-icon">✓</span>
          </div>
        )}
      </div>
      <div className="vehicle-info">
        <h3>{`${year} ${make} ${model}`}</h3>
        <div className="vehicle-vin">VIN: {vin}</div>
        
        {sources.length > 0 && (
          <div className="vehicle-sources">
            Data sources: 
            {sources.map((source, index) => (
              <span 
                key={source.id} 
                className={`source-badge ${getSourceBadgeClass(source.type)}`}
                title={`Source: ${source.name}, Time: ${source.timestamp.toLocaleDateString()}, Confidence: ${source.confidenceScore.toFixed(2)}`}
              >
                {source.name}
              </span>
            ))}
          </div>
        )}
        
        {confidenceScore > 0 && (
          <div className="confidence-score">
            Confidence: {confidenceScore.toFixed(2)}
            <div className="confidence-meter">
              <div 
                className="confidence-value" 
                style={{ width: `${Math.min(confidenceScore * 100, 100)}%` }}
              />
            </div>
          </div>
        )}
        
        {ownershipHistory > 0 && (
          <div className="ownership-history">
            Ownership changes: {ownershipHistory}
          </div>
        )}
        
        {lastUpdated && (
          <div className="last-updated">
            Last updated: {lastUpdated.toLocaleDateString()}
          </div>
        )}
      </div>
    </div>
  );
};
