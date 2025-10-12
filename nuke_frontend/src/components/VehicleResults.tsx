import React from 'react';

interface VehicleResultsProps {
  vehicleId: string;
  salePrice?: number;
  auctionEndDate?: string;
  bidCount?: number;
  viewCount?: number;
  auctionSource?: string;
}

const VehicleResults: React.FC<VehicleResultsProps> = ({
  salePrice,
  auctionEndDate,
  bidCount,
  viewCount,
  auctionSource
}) => {
  if (!salePrice && !auctionEndDate) {
    return null;
  }

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  return (
    <div className="vehicle-section">
      <h3 className="section-title">Auction Result</h3>
      <div className="results-container">
        {salePrice && (
          <div className="result-item primary-result">
            <div className="result-label">Winning Bid</div>
            <div className="result-value price">{formatPrice(salePrice)}</div>
            {auctionSource && (
              <div className="result-source">by {auctionSource}</div>
            )}
          </div>
        )}

        {auctionEndDate && (
          <div className="result-item">
            <div className="result-label">Auction Ended</div>
            <div className="result-value">{auctionEndDate}</div>
          </div>
        )}

        <div className="result-stats">
          {bidCount && (
            <div className="stat-item">
              <span className="stat-number">{formatNumber(bidCount)}</span>
              <span className="stat-label">Bids</span>
            </div>
          )}
          
          {viewCount && (
            <div className="stat-item">
              <span className="stat-number">{formatNumber(viewCount)}</span>
              <span className="stat-label">Views</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VehicleResults;
