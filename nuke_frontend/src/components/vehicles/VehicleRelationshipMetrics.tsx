import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { handleExpectedError } from '../../utils/errorCache';

interface VehicleRelationshipMetricsProps {
  vehicleId: string;
  organizationId?: string;
  relationshipType?: string;
  userId?: string;
}

interface ServiceMetrics {
  daysOnLot: number;
  parkingCostPerDay: number;
  totalParkingCost: number;
  materialCost: number;
  laborCost: number;
  contractorCost: number;
  ownerOperatorHours: number;
  ownerOperatorRate: number;
  ownerOperatorValue: number;
  laborHours: number;
  totalCost: number;
  estimatedCompletion?: string;
}

const VehicleRelationshipMetrics: React.FC<VehicleRelationshipMetricsProps> = ({
  vehicleId,
  organizationId,
  relationshipType,
  userId
}) => {
  const [metrics, setMetrics] = useState<ServiceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [parkingRate, setParkingRate] = useState<number | null>(null);

  useEffect(() => {
    if (relationshipType === 'service_provider' || relationshipType === 'work_location') {
      loadServiceMetrics();
    } else if (relationshipType === 'owner') {
      loadOwnerMetrics();
    } else {
      setLoading(false);
    }
  }, [vehicleId, organizationId, relationshipType, userId]);

  const loadServiceMetrics = async () => {
    try {
      setLoading(true);

      // Get organization vehicle record for start date
      const { data: orgVehicle } = await supabase
        .from('organization_vehicles')
        .select('start_date, notes')
        .eq('vehicle_id', vehicleId)
        .eq('organization_id', organizationId)
        .eq('relationship_type', relationshipType)
        .eq('status', 'active')
        .single();

      const startDate = orgVehicle?.start_date ? new Date(orgVehicle.start_date) : null;
      const daysOnLot = startDate 
        ? Math.floor((new Date().getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      // Get parking rate from organization settings or notes
      // Check if notes contain parking rate
      let parkingCostPerDay = 0;
      if (orgVehicle?.notes) {
        const parkingMatch = orgVehicle.notes.match(/\$?(\d+(?:\.\d+)?)\s*\/?\s*(?:day|daily)/i);
        if (parkingMatch) {
          parkingCostPerDay = parseFloat(parkingMatch[1]);
        }
      }

      // If no parking rate in notes, try to get from organization settings
      if (!parkingCostPerDay && organizationId) {
        try {
          const { data: orgSettings, error: orgError } = await supabase
            .from('businesses')
            .select('parking_rate_per_day')
            .eq('id', organizationId)
            .single();
          
          // Gracefully handle missing table or column
          if (!orgError && orgSettings?.parking_rate_per_day) {
            parkingCostPerDay = orgSettings.parking_rate_per_day;
          } else if (orgError) {
            // Silently handle missing feature
            handleExpectedError(orgError, 'Parking Rate');
          }
        } catch (error) {
          // Column or table may not exist - silently skip
          handleExpectedError(error, 'Parking Rate');
        }
      }

      // Load financial records from timeline events
      let timelineEvents: any[] = [];
      try {
        const { data, error: eventsError } = await supabase
          .from('timeline_events')
          .select(`
            id,
            metadata,
            receipt_amount,
            event_financial_records (
              labor_cost,
              labor_hours,
              labor_rate,
              parts_cost,
              supplies_cost,
              total_cost
            )
          `)
          .eq('vehicle_id', vehicleId)
          .eq('organization_id', organizationId);
        
        // Gracefully handle missing relationship or column
        if (!eventsError && data) {
          timelineEvents = data;
        } else if (eventsError) {
          // Silently handle missing feature
          handleExpectedError(eventsError, 'Timeline Events Organization Filter');
        }
      } catch (error) {
        // Organization relationship column may not exist - silently skip
        handleExpectedError(error, 'Timeline Events Organization Filter');
      }

      // Calculate totals
      let materialCost = 0;
      let laborCost = 0;
      let contractorCost = 0;
      let ownerOperatorHours = 0;
      let laborHours = 0;

      (timelineEvents || []).forEach((event: any) => {
        // Process financial records
        if (event.event_financial_records && event.event_financial_records.length > 0) {
          event.event_financial_records.forEach((record: any) => {
            materialCost += parseFloat(record.parts_cost || 0) + parseFloat(record.supplies_cost || 0);
            laborCost += parseFloat(record.labor_cost || 0);
            laborHours += parseFloat(record.labor_hours || 0);
            
            // Check if this is owner operator work
            if (event.metadata?.owner_operator) {
              ownerOperatorHours += parseFloat(record.labor_hours || 0);
            }
          });
        }
        
        // Check for contractor payments
        if (event.receipt_amount && (event.metadata?.contractor_payment || event.metadata?.contractor)) {
          contractorCost += parseFloat(event.receipt_amount || 0);
        }
      });

      // Owner operator rate (default or from user profile)
      const ownerOperatorRate = 75; // Default, could be from user profile

      const totalParkingCost = daysOnLot * parkingCostPerDay;
      const totalCost = materialCost + laborCost + contractorCost + totalParkingCost;
      const ownerOperatorValue = ownerOperatorHours * ownerOperatorRate;

      setMetrics({
        daysOnLot,
        parkingCostPerDay,
        totalParkingCost,
        materialCost,
        laborCost,
        contractorCost,
        ownerOperatorHours,
        ownerOperatorRate,
        ownerOperatorValue,
        laborHours,
        totalCost
      });
    } catch (error) {
      console.error('Error loading service metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadOwnerMetrics = async () => {
    // For owned vehicles, show traditional ROI
    // This is already handled in GarageVehicleCard
    setLoading(false);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  if (loading) {
    return (
      <div style={{ fontSize: '7pt', color: '#9ca3af', padding: '4px 0' }}>
        Loading metrics...
      </div>
    );
  }

  if (!metrics) {
    return null;
  }

  // Service vehicle metrics
  if (relationshipType === 'service_provider' || relationshipType === 'work_location') {
    return (
      <div
        style={{
          marginTop: '8px',
          padding: '8px',
          background: '#f0f9ff',
          border: '1px solid #bfdbfe',
          borderRadius: '4px',
          fontSize: '7pt'
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: '6px', color: '#1e40af' }}>
          SERVICE METRICS
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '6px' }}>
          <div>
            <span style={{ color: '#6b7280' }}>Days on lot:</span>
            <span style={{ fontWeight: 600, marginLeft: '4px' }}>{metrics.daysOnLot}</span>
          </div>
          {metrics.parkingCostPerDay > 0 && (
            <div>
              <span style={{ color: '#6b7280' }}>Parking:</span>
              <span style={{ fontWeight: 600, marginLeft: '4px' }}>
                {formatCurrency(metrics.totalParkingCost)}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '6px' }}>
          <div>
            <span style={{ color: '#6b7280' }}>Materials:</span>
            <span style={{ fontWeight: 600, marginLeft: '4px' }}>
              {formatCurrency(metrics.materialCost)}
            </span>
          </div>
          <div>
            <span style={{ color: '#6b7280' }}>Labor:</span>
            <span style={{ fontWeight: 600, marginLeft: '4px' }}>
              {formatCurrency(metrics.laborCost)}
            </span>
            {metrics.laborHours > 0 && (
              <span style={{ color: '#9ca3af', marginLeft: '4px' }}>
                ({metrics.laborHours.toFixed(1)}h)
              </span>
            )}
          </div>
        </div>

        {metrics.contractorCost > 0 && (
          <div style={{ marginBottom: '6px' }}>
            <span style={{ color: '#6b7280' }}>Contractors:</span>
            <span style={{ fontWeight: 600, marginLeft: '4px' }}>
              {formatCurrency(metrics.contractorCost)}
            </span>
          </div>
        )}

        {metrics.ownerOperatorHours > 0 && (
          <div style={{ 
            marginTop: '6px', 
            padding: '4px 6px', 
            background: '#fef3c7', 
            border: '1px solid #f59e0b',
            borderRadius: '2px'
          }}>
            <div style={{ fontSize: '6pt', color: '#92400e', marginBottom: '2px' }}>
              OWNER OPERATOR VALUE
            </div>
            <div style={{ fontWeight: 700, color: '#92400e' }}>
              {metrics.ownerOperatorHours.toFixed(1)}h × ${metrics.ownerOperatorRate}/hr = {formatCurrency(metrics.ownerOperatorValue)}
            </div>
          </div>
        )}

        <div style={{ 
          marginTop: '6px', 
          paddingTop: '6px', 
          borderTop: '1px solid #bfdbfe',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ color: '#6b7280' }}>Total Cost:</span>
          <span style={{ fontWeight: 700, fontSize: '8pt', color: '#1e40af' }}>
            {formatCurrency(metrics.totalCost)}
          </span>
        </div>
      </div>
    );
  }

  return null;
};

export default VehicleRelationshipMetrics;

