/**
 * Service Vehicle Card Component
 * 
 * Shows service vehicles with receipt-driven information
 * Displays work in progress, investment, time, and job details
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';

interface Receipt {
  id: string;
  date: string;
  total: number;
  status: string;
  labor_hours: number;
  parts_cost: number;
  labor_cost: number;
  work_description?: string;
}

interface ServiceVehicleCardProps {
  vehicleId: string;
  vehicleInfo: {
    year: number | null;
    make: string | null;
    model: string | null;
    vin?: string | null;
  };
  receipts: Receipt[];
  totalInvestment: number;
  totalDays: number;
  totalLaborHours: number;
  jobCount: number;
  currentStatus: 'in_progress' | 'completed' | 'on_hold' | 'pending';
  primaryImageUrl?: string | null;
}

export const ServiceVehicleCard: React.FC<ServiceVehicleCardProps> = ({
  vehicleId,
  vehicleInfo,
  receipts,
  totalInvestment,
  totalDays,
  totalLaborHours,
  jobCount,
  currentStatus,
  primaryImageUrl
}) => {
  const navigate = useNavigate();

  const statusColors = {
    in_progress: '#3b82f6',
    completed: '#10b981',
    on_hold: '#f59e0b',
    pending: '#6b7280'
  };

  const statusLabels = {
    in_progress: 'In Progress',
    completed: 'Completed',
    on_hold: 'On Hold',
    pending: 'Pending'
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  return (
    <div
      className="card"
      style={{
        marginBottom: '16px',
        cursor: 'pointer',
        transition: 'transform 0.12s ease, box-shadow 0.12s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '';
      }}
      onClick={() => navigate(`/vehicle/${vehicleId}`)}
    >
      <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
        SERVICE
      </div>

      {/* Vehicle Image with Receipt Badges */}
      <div
        style={{
          width: '100%',
          height: '200px',
          backgroundImage: primaryImageUrl
            ? `url(${primaryImageUrl})`
            : 'linear-gradient(135deg, var(--grey-200) 0%, var(--grey-300) 100%)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-end',
          padding: '12px'
        }}
      >
        {/* Receipt Badges (circles) */}
        {receipts.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap'
            }}
          >
            {receipts.slice(0, 5).map((receipt, index) => (
              <div
                key={receipt.id}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.9)',
                  border: '2px solid var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '9pt',
                  fontWeight: 'bold',
                  color: 'var(--accent)',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}
                title={`Receipt ${index + 1}: ${formatCurrency(receipt.total)}`}
              >
                R{index + 1}
              </div>
            ))}
            {receipts.length > 5 && (
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.9)',
                  border: '2px solid var(--grey-400)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '8pt',
                  fontWeight: 'bold',
                  color: 'var(--grey-600)',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}
                title={`${receipts.length - 5} more receipts`}
              >
                +{receipts.length - 5}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Vehicle Info */}
      <div className="card-body">
        <div style={{ fontSize: '12pt', fontWeight: 600, marginBottom: '12px' }}>
          {vehicleInfo.year} {vehicleInfo.make} {vehicleInfo.model}
          {vehicleInfo.vin && (
            <span style={{ fontSize: '9pt', color: 'var(--grey-600)', marginLeft: '8px' }}>
              {vehicleInfo.vin}
            </span>
          )}
        </div>

        {/* Stats Summary */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: '8px',
            marginBottom: '12px',
            padding: '12px',
            background: 'var(--grey-100)',
            borderRadius: '4px'
          }}
        >
          <div>
            <div style={{ fontSize: '8pt', color: 'var(--grey-600)', marginBottom: '4px' }}>
              Investment
            </div>
            <div style={{ fontSize: '11pt', fontWeight: 600 }}>
              {formatCurrency(totalInvestment)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '8pt', color: 'var(--grey-600)', marginBottom: '4px' }}>
              Time
            </div>
            <div style={{ fontSize: '11pt', fontWeight: 600 }}>
              {totalDays} {totalDays === 1 ? 'day' : 'days'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '8pt', color: 'var(--grey-600)', marginBottom: '4px' }}>
              Jobs
            </div>
            <div style={{ fontSize: '11pt', fontWeight: 600 }}>
              {jobCount} {jobCount === 1 ? 'receipt' : 'receipts'}
            </div>
          </div>
        </div>

        {/* Status Badge */}
        <div
          style={{
            display: 'inline-block',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '8pt',
            fontWeight: 600,
            background: statusColors[currentStatus] + '20',
            color: statusColors[currentStatus],
            marginBottom: '12px'
          }}
        >
          {statusLabels[currentStatus]}
        </div>

        {/* Recent Work */}
        {receipts.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            <div
              style={{
                fontSize: '9pt',
                fontWeight: 600,
                color: 'var(--grey-700)',
                marginBottom: '8px'
              }}
            >
              Recent Work:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {receipts.slice(0, 3).map((receipt, index) => (
                <div
                  key={receipt.id}
                  style={{
                    fontSize: '9pt',
                    padding: '6px',
                    background: 'var(--grey-50)',
                    borderRadius: '4px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600 }}>
                      {receipt.work_description || `Job ${index + 1}`}
                    </span>
                    {receipt.labor_hours > 0 && (
                      <span style={{ color: 'var(--grey-600)', marginLeft: '8px' }}>
                        • {receipt.labor_hours.toFixed(1)} hours
                      </span>
                    )}
                  </div>
                  <div style={{ fontWeight: 600, color: 'var(--accent)' }}>
                    {formatCurrency(receipt.total)}
                  </div>
                </div>
              ))}
              {receipts.length > 3 && (
                <div
                  style={{
                    fontSize: '8pt',
                    color: 'var(--grey-600)',
                    textAlign: 'center',
                    padding: '4px'
                  }}
                >
                  +{receipts.length - 3} more {receipts.length - 3 === 1 ? 'job' : 'jobs'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

