import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface TradeDetailsManagerProps {
  vehicleId: string;
  vehicleName: string;
  isOwner: boolean;
}

interface TradeData {
  id: string;
  trade_date: string;
  trade_type: string;
  cash_amount_paid: number;
  cash_received: number;
  total_deal_value: number;
  traded_with_party: string;
  trade_notes: string;
  items: TradeItem[];
}

interface TradeItem {
  id: string;
  traded_vehicle_id: string;
  agreed_value: number;
  condition_at_trade: string;
  notes: string;
  vehicle: {
    year: number;
    make: string;
    model: string;
    series: string;
  } | null;
}

const TradeDetailsManager: React.FC<TradeDetailsManagerProps> = ({ vehicleId, vehicleName, isOwner }) => {
  const [trade, setTrade] = useState<TradeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [userVehicles, setUserVehicles] = useState<any[]>([]);
  
  // Form state
  const [tradeDate, setTradeDate] = useState('');
  const [tradeType, setTradeType] = useState('purchase_with_trade');
  const [cashPaid, setCashPaid] = useState(0);
  const [cashReceived, setCashReceived] = useState(0);
  const [cashDirection, setCashDirection] = useState<'paid' | 'received'>('paid');
  const [tradedWithParty, setTradedWithParty] = useState('');
  const [tradeNotes, setTradeNotes] = useState('');
  const [selectedVehicles, setSelectedVehicles] = useState<Array<{vehicleId: string; value: number}>>([]);

  useEffect(() => {
    loadTradeData();
    if (isOwner) {
      loadUserVehicles();
    }
  }, [vehicleId]);

  const loadTradeData = async () => {
    try {
      const { data: tradeData, error } = await supabase
        .from('vehicle_trades')
        .select(`
          *,
          items:vehicle_trade_items(
            *,
            vehicle:traded_vehicle_id(year, make, model, series)
          )
        `)
        .eq('acquired_vehicle_id', vehicleId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      
      if (tradeData) {
        setTrade(tradeData);
        setTradeDate(tradeData.trade_date);
        setTradeType(tradeData.trade_type);
        
        // Determine cash direction
        if (tradeData.cash_received > 0) {
          setCashDirection('received');
          setCashReceived(tradeData.cash_received);
          setCashPaid(0);
        } else {
          setCashDirection('paid');
          setCashPaid(tradeData.cash_amount_paid || 0);
          setCashReceived(0);
        }
        
        setTradedWithParty(tradeData.traded_with_party || '');
        setTradeNotes(tradeData.trade_notes || '');
        setSelectedVehicles(
          (tradeData.items || []).map((item: any) => ({
            vehicleId: item.traded_vehicle_id,
            value: item.agreed_value || 0
          }))
        );
      }
    } catch (error) {
      console.error('Error loading trade data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUserVehicles = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('vehicles')
      .select('id, year, make, model, series')
      .eq('uploaded_by', user.id)
      .neq('id', vehicleId)
      .order('year', { ascending: false });

    if (!error && data) {
      setUserVehicles(data);
    }
  };

  const saveTrade = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const cashValue = cashDirection === 'received' ? cashReceived : cashPaid;
      const vehiclesValue = selectedVehicles.reduce((sum, v) => sum + v.value, 0);
      
      // Calculate total deal value based on direction
      const totalDealValue = cashDirection === 'received' 
        ? vehiclesValue - cashValue  // You gave up vehicles but got cash back
        : vehiclesValue + cashValue;  // You gave up vehicles + cash

      if (trade?.id) {
        // Update existing trade
        await supabase
          .from('vehicle_trades')
          .update({
            trade_date: tradeDate,
            trade_type: tradeType,
            cash_amount_paid: cashDirection === 'paid' ? cashPaid : 0,
            cash_received: cashDirection === 'received' ? cashReceived : 0,
            total_deal_value: totalDealValue,
            traded_with_party: tradedWithParty,
            trade_notes: tradeNotes,
            updated_at: new Date().toISOString()
          })
          .eq('id', trade.id);

        // Delete existing items
        await supabase
          .from('vehicle_trade_items')
          .delete()
          .eq('trade_id', trade.id);

      } else {
        // Create new trade
        const { data: newTrade, error: tradeError } = await supabase
          .from('vehicle_trades')
          .insert({
            acquired_vehicle_id: vehicleId,
            trade_date: tradeDate,
            trade_type: tradeType,
            cash_amount_paid: cashDirection === 'paid' ? cashPaid : 0,
            cash_received: cashDirection === 'received' ? cashReceived : 0,
            total_deal_value: totalDealValue,
            traded_with_party: tradedWithParty,
            trade_notes: tradeNotes,
            created_by: user.id
          })
          .select()
          .single();

        if (tradeError) throw tradeError;
        
        // Insert trade items
        if (newTrade && selectedVehicles.length > 0) {
          await supabase
            .from('vehicle_trade_items')
            .insert(
              selectedVehicles.map(v => ({
                trade_id: newTrade.id,
                traded_vehicle_id: v.vehicleId,
                agreed_value: v.value
              }))
            );
        }
      }

      setEditing(false);
      loadTradeData();
      alert('Trade details saved successfully');
    } catch (error) {
      console.error('Error saving trade:', error);
      alert('Failed to save trade details');
    }
  };

  const addVehicleToTrade = () => {
    setSelectedVehicles([...selectedVehicles, { vehicleId: '', value: 0 }]);
  };

  const removeVehicleFromTrade = (index: number) => {
    setSelectedVehicles(selectedVehicles.filter((_, i) => i !== index));
  };

  if (loading) {
    return <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Loading trade details...</div>;
  }

  if (!isOwner && !trade) {
    return null;
  }

  if (!editing && !trade) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="button-primary"
        style={{ fontSize: '9pt' }}
      >
        Record Trade Details
      </button>
    );
  }

  if (!editing && trade) {
    return (
      <div style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h4 style={{ fontSize: '10pt', fontWeight: 'bold' }}>Trade Details</h4>
          {isOwner && (
            <button onClick={() => setEditing(true)} className="button-secondary" style={{ fontSize: '8pt' }}>
              Edit
            </button>
          )}
        </div>

        <div style={{ background: 'var(--bg)', padding: '12px', border: '2px solid #e5e7eb', borderRadius: '4px' }}>
          <div style={{ marginBottom: '8px' }}>
            <strong style={{ fontSize: '8pt', color: '#6b7280' }}>Trade Date:</strong>{' '}
            <span style={{ fontSize: '9pt' }}>{new Date(trade.trade_date).toLocaleDateString()}</span>
          </div>

          {trade.cash_amount_paid > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <strong style={{ fontSize: '8pt', color: '#6b7280' }}>Cash Paid:</strong>{' '}
              <span style={{ fontSize: '9pt' }}>${trade.cash_amount_paid.toLocaleString()}</span>
            </div>
          )}

          {trade.cash_received > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <strong style={{ fontSize: '8pt', color: '#6b7280' }}>Cash Received:</strong>{' '}
              <span style={{ fontSize: '9pt', color: '#059669' }}>+${trade.cash_received.toLocaleString()}</span>
            </div>
          )}

          {trade.items && trade.items.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <strong style={{ fontSize: '8pt', color: '#6b7280' }}>Vehicles Traded:</strong>
              <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                {trade.items.map(item => (
                  <li key={item.id} style={{ fontSize: '9pt', marginBottom: '4px' }}>
                    {item.vehicle ? (
                      <>
                        {item.vehicle.year} {item.vehicle.make} {item.vehicle.model || item.vehicle.series}
                        {' - '}
                        <span style={{ fontWeight: 'bold' }}>${item.agreed_value.toLocaleString()}</span>
                      </>
                    ) : (
                      `Vehicle ID: ${item.traded_vehicle_id} - $${item.agreed_value.toLocaleString()}`
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ marginBottom: '8px' }}>
            <strong style={{ fontSize: '8pt', color: '#6b7280' }}>Total Deal Value:</strong>{' '}
            <span style={{ fontSize: '10pt', fontWeight: 'bold' }}>${trade.total_deal_value.toLocaleString()}</span>
          </div>

          {trade.traded_with_party && (
            <div style={{ marginBottom: '8px' }}>
              <strong style={{ fontSize: '8pt', color: '#6b7280' }}>Traded With:</strong>{' '}
              <span style={{ fontSize: '9pt' }}>{trade.traded_with_party}</span>
            </div>
          )}

          {trade.trade_notes && (
            <div>
              <strong style={{ fontSize: '8pt', color: '#6b7280' }}>Notes:</strong>
              <div style={{ fontSize: '9pt', marginTop: '4px', whiteSpace: 'pre-wrap' }}>
                {trade.trade_notes}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Editing mode
  return (
    <div style={{ marginTop: '16px', padding: '16px', background: 'var(--surface)', border: '2px solid #e5e7eb', borderRadius: '4px' }}>
      <h4 style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '12px' }}>
        {trade ? 'Edit' : 'Record'} Trade Details
      </h4>

      <div className="form-group" style={{ marginBottom: '12px' }}>
        <label htmlFor="trade_date" className="form-label">Trade Date</label>
        <input
          type="date"
          id="trade_date"
          value={tradeDate}
          onChange={(e) => setTradeDate(e.target.value)}
          className="form-input"
        />
      </div>

      <div className="form-group" style={{ marginBottom: '12px' }}>
        <label htmlFor="trade_type" className="form-label">Trade Type</label>
        <select
          id="trade_type"
          value={tradeType}
          onChange={(e) => setTradeType(e.target.value)}
          className="form-select"
        >
          <option value="purchase_with_trade">Purchase with Trade-in</option>
          <option value="straight_trade">Straight Trade (Vehicle for Vehicle)</option>
          <option value="partial_trade">Partial Trade (Multiple Vehicles + Cash)</option>
        </select>
      </div>

      <div className="form-group" style={{ marginBottom: '12px' }}>
        <label className="form-label">Cash Direction</label>
        <div style={{ display: 'flex', gap: '16px', marginTop: '8px', marginBottom: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="radio"
              name="cash_direction"
              value="paid"
              checked={cashDirection === 'paid'}
              onChange={() => setCashDirection('paid')}
              style={{ cursor: 'pointer' }}
            />
            <span style={{ fontSize: '9pt' }}>I paid cash</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="radio"
              name="cash_direction"
              value="received"
              checked={cashDirection === 'received'}
              onChange={() => setCashDirection('received')}
              style={{ cursor: 'pointer' }}
            />
            <span style={{ fontSize: '9pt' }}>I received cash</span>
          </label>
        </div>

        {cashDirection === 'paid' ? (
          <input
            type="number"
            value={cashPaid}
            onChange={(e) => setCashPaid(parseFloat(e.target.value) || 0)}
            className="form-input"
            placeholder="$ Cash I paid"
            min="0"
            step="100"
          />
        ) : (
          <input
            type="number"
            value={cashReceived}
            onChange={(e) => setCashReceived(parseFloat(e.target.value) || 0)}
            className="form-input"
            placeholder="$ Cash I received"
            min="0"
            step="100"
          />
        )}
      </div>

      <div className="form-group" style={{ marginBottom: '12px' }}>
        <label className="form-label">Vehicles Traded</label>
        {selectedVehicles.map((sv, index) => (
          <div key={index} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <select
              value={sv.vehicleId}
              onChange={(e) => {
                const newVehicles = [...selectedVehicles];
                newVehicles[index].vehicleId = e.target.value;
                setSelectedVehicles(newVehicles);
              }}
              className="form-select"
              style={{ flex: 2 }}
            >
              <option value="">Select vehicle...</option>
              {userVehicles.map(v => (
                <option key={v.id} value={v.id}>
                  {v.year} {v.make} {v.model || v.series}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={sv.value}
              onChange={(e) => {
                const newVehicles = [...selectedVehicles];
                newVehicles[index].value = parseFloat(e.target.value) || 0;
                setSelectedVehicles(newVehicles);
              }}
              className="form-input"
              placeholder="$ Value"
              min="0"
              step="100"
              style={{ flex: 1 }}
            />
            <button
              onClick={() => removeVehicleFromTrade(index)}
              className="button-secondary"
              style={{ fontSize: '8pt', padding: '4px 8px' }}
            >
              Remove
            </button>
          </div>
        ))}
        <button onClick={addVehicleToTrade} className="button-secondary" style={{ fontSize: '8pt', marginTop: '4px' }}>
          + Add Vehicle
        </button>
      </div>

      <div className="form-group" style={{ marginBottom: '12px' }}>
        <label htmlFor="traded_with_party" className="form-label">Traded With (Optional)</label>
        <input
          type="text"
          id="traded_with_party"
          value={tradedWithParty}
          onChange={(e) => setTradedWithParty(e.target.value)}
          className="form-input"
          placeholder="e.g., Dealer name, Private party"
        />
      </div>

      <div className="form-group" style={{ marginBottom: '12px' }}>
        <label htmlFor="trade_notes" className="form-label">Notes (Optional)</label>
        <textarea
          id="trade_notes"
          value={tradeNotes}
          onChange={(e) => setTradeNotes(e.target.value)}
          className="form-input"
          rows={3}
          placeholder="Any additional details about the trade..."
          style={{ resize: 'vertical' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button onClick={saveTrade} className="button-primary" style={{ fontSize: '9pt' }}>
          Save Trade Details
        </button>
        <button
          onClick={() => {
            setEditing(false);
            if (!trade) {
              // Reset form if canceling new trade
              setTradeDate('');
              setCashPaid(0);
              setSelectedVehicles([]);
              setTradedWithParty('');
              setTradeNotes('');
            }
          }}
          className="button-secondary"
          style={{ fontSize: '9pt' }}
        >
          Cancel
        </button>
      </div>

      <div style={{ marginTop: '12px', padding: '12px', background: 'var(--bg)', border: '2px solid #e5e7eb', borderRadius: '4px' }}>
        <div style={{ fontSize: '8pt', color: '#6b7280', marginBottom: '4px' }}>
          <strong>Trade Summary:</strong>
        </div>
        <div style={{ fontSize: '9pt', marginBottom: '4px' }}>
          Vehicles traded: ${selectedVehicles.reduce((sum, v) => sum + v.value, 0).toLocaleString()}
        </div>
        <div style={{ fontSize: '9pt', marginBottom: '4px', color: cashDirection === 'received' ? '#059669' : '#000' }}>
          Cash {cashDirection}: ${(cashDirection === 'paid' ? cashPaid : cashReceived).toLocaleString()}
        </div>
        <div style={{ fontSize: '10pt', fontWeight: 'bold', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #e5e7eb' }}>
          Net value of vehicles traded: $
          {(
            cashDirection === 'received' 
              ? selectedVehicles.reduce((sum, v) => sum + v.value, 0) - cashReceived
              : selectedVehicles.reduce((sum, v) => sum + v.value, 0) + cashPaid
          ).toLocaleString()}
        </div>
      </div>
    </div>
  );
};

export default TradeDetailsManager;

