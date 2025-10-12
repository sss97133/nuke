import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import UniversalImageUpload from './UniversalImageUpload';

interface WorkEntry {
  id?: string;
  work_type: 'maintenance' | 'repair' | 'modification' | 'inspection';
  work_description: string;
  date_performed: string;
  mileage: number;
  labor_hours: number;
  total_cost: number;
  parts_used: string;
  has_receipts: boolean;
  materials_used: string;
  notes: string;
}

interface WorkDocumentationPanelProps {
  vehicleId: string;
  currentUserId: string;
  isOwner: boolean;
}

const WorkDocumentationPanel: React.FC<WorkDocumentationPanelProps> = ({
  vehicleId,
  currentUserId,
  isOwner
}) => {
  const [workEntries, setWorkEntries] = useState<WorkEntry[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntry, setNewEntry] = useState<WorkEntry>({
    work_type: 'maintenance',
    work_description: '',
    date_performed: new Date().toISOString().split('T')[0],
    mileage: 0,
    labor_hours: 0,
    total_cost: 0,
    parts_used: '',
    has_receipts: false,
    materials_used: '',
    notes: ''
  });

  useEffect(() => {
    loadWorkEntries();
  }, [vehicleId]);

  const loadWorkEntries = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicle_timeline_events')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false });

      if (error) throw error;

      const formatted = (data || []).map((event: any) => ({
        id: event.id,
        work_type: (event.event_type || 'maintenance').toLowerCase(),
        work_description: event.title || '',
        date_performed: event.event_date || '',
        mileage: event.mileage_at_event || event.metadata?.mileage || 0,
        labor_hours: event.metadata?.labor_hours || 0,
        total_cost: event.receipt_amount || event.metadata?.total_cost || 0,
        parts_used: Array.isArray(event.metadata?.parts_used) ? event.metadata.parts_used.map((p: any) => p.part_name).join(', ') : '',
        has_receipts: !!event.metadata?.receipt_image,
        materials_used: event.metadata?.materials_used || '',
        notes: event.description || ''
      }));

      setWorkEntries(formatted);
    } catch (error) {
      console.error('Error loading work entries:', error);
    }
  };

  const saveWorkEntry = async () => {
    try {
      const metadata = {
        labor_hours: newEntry.labor_hours,
        parts_used: newEntry.parts_used.split(',').map(p => ({ part_name: p.trim() })),
        materials_used: newEntry.materials_used,
        has_receipts: newEntry.has_receipts
      };

      const { error } = await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: vehicleId,
          user_id: currentUserId,
          event_type: newEntry.work_type,
          source: 'user_input',
          title: newEntry.work_description,
          description: newEntry.notes,
          event_date: newEntry.date_performed,
          metadata
        });

      if (error) throw error;

      setNewEntry({
        work_type: 'maintenance',
        work_description: '',
        date_performed: new Date().toISOString().split('T')[0],
        mileage: 0,
        labor_hours: 0,
        total_cost: 0,
        parts_used: '',
        has_receipts: false,
        materials_used: '',
        notes: ''
      });
      setShowAddForm(false);
      loadWorkEntries();

    } catch (error) {
      console.error('Error saving work entry:', error);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Work Documentation</span>
          <button 
            className="button button-primary"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? 'Cancel' : 'Add Work'}
          </button>
        </div>
      </div>

      <div className="card-body">
        {showAddForm && (
          <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f8f9fa', border: '1px solid #e9ecef' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <div>
                <label style={{ fontSize: '8pt', fontWeight: 'bold', display: 'block', marginBottom: '2px' }}>
                  Work Type
                </label>
                <select
                  value={newEntry.work_type}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, work_type: e.target.value as any }))}
                  style={{ width: '100%', padding: '4px', fontSize: '8pt' }}
                >
                  <option value="maintenance">Maintenance</option>
                  <option value="repair">Repair</option>
                  <option value="modification">Modification</option>
                  <option value="inspection">Inspection</option>
                </select>
              </div>
              
              <div>
                <label style={{ fontSize: '8pt', fontWeight: 'bold', display: 'block', marginBottom: '2px' }}>
                  Date
                </label>
                <input
                  type="date"
                  value={newEntry.date_performed}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, date_performed: e.target.value }))}
                  style={{ width: '100%', padding: '4px', fontSize: '8pt' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '8pt', fontWeight: 'bold', display: 'block', marginBottom: '2px' }}>
                Work Description
              </label>
              <input
                type="text"
                value={newEntry.work_description}
                onChange={(e) => setNewEntry(prev => ({ ...prev, work_description: e.target.value }))}
                placeholder="Oil change, brake pads, engine repair, etc."
                style={{ width: '100%', padding: '4px', fontSize: '8pt' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <div>
                <label style={{ fontSize: '8pt', fontWeight: 'bold', display: 'block', marginBottom: '2px' }}>
                  Mileage
                </label>
                <input
                  type="number"
                  value={newEntry.mileage || ''}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, mileage: parseInt(e.target.value) || 0 }))}
                  style={{ width: '100%', padding: '4px', fontSize: '8pt' }}
                />
              </div>
              
              <div>
                <label style={{ fontSize: '8pt', fontWeight: 'bold', display: 'block', marginBottom: '2px' }}>
                  Hours
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={newEntry.labor_hours || ''}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, labor_hours: parseFloat(e.target.value) || 0 }))}
                  style={{ width: '100%', padding: '4px', fontSize: '8pt' }}
                />
              </div>
              
              <div>
                <label style={{ fontSize: '8pt', fontWeight: 'bold', display: 'block', marginBottom: '2px' }}>
                  Cost
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={newEntry.total_cost || ''}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, total_cost: parseFloat(e.target.value) || 0 }))}
                  style={{ width: '100%', padding: '4px', fontSize: '8pt' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '8pt', fontWeight: 'bold', display: 'block', marginBottom: '2px' }}>
                Parts Used
              </label>
              <input
                type="text"
                value={newEntry.parts_used}
                onChange={(e) => setNewEntry(prev => ({ ...prev, parts_used: e.target.value }))}
                placeholder="Oil filter, brake pads, spark plugs, etc."
                style={{ width: '100%', padding: '4px', fontSize: '8pt' }}
              />
            </div>

            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '8pt', fontWeight: 'bold', display: 'block', marginBottom: '2px' }}>
                Materials Used
              </label>
              <input
                type="text"
                value={newEntry.materials_used}
                onChange={(e) => setNewEntry(prev => ({ ...prev, materials_used: e.target.value }))}
                placeholder="5W-30 oil, brake fluid, coolant, etc."
                style={{ width: '100%', padding: '4px', fontSize: '8pt' }}
              />
            </div>

            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '8pt', fontWeight: 'bold', display: 'block', marginBottom: '2px' }}>
                Notes
              </label>
              <textarea
                value={newEntry.notes}
                onChange={(e) => setNewEntry(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Additional details, findings, recommendations..."
                style={{ width: '100%', padding: '4px', fontSize: '8pt', height: '60px', resize: 'none' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <label style={{ fontSize: '8pt', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  type="checkbox"
                  checked={newEntry.has_receipts}
                  onChange={(e) => setNewEntry(prev => ({ ...prev, has_receipts: e.target.checked }))}
                />
                Have receipts
              </label>
            </div>

            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '8pt', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
                Upload Images
              </label>
              <UniversalImageUpload
                vehicleId={vehicleId}
                variant="quick"
                category="repair"
                maxFiles={5}
                onUploadSuccess={(results) => {
                  console.log('Images uploaded:', results.map(r => r.imageUrl));
                  // Could auto-analyze images here for AI extraction
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                className="button button-primary"
                onClick={saveWorkEntry}
                disabled={!newEntry.work_description.trim()}
              >
                Save Work
              </button>
              <button 
                className="button"
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {workEntries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: '#6b7280' }}>
            <div style={{ fontSize: '8pt', marginBottom: '8px' }}>No work documented</div>
            <div style={{ fontSize: '8pt' }}>Add work to track maintenance and build value</div>
          </div>
        ) : (
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {workEntries.map((entry) => (
              <div 
                key={entry.id} 
                style={{ 
                  padding: '8px', 
                  borderBottom: '1px solid #e5e7eb',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: '2px' }}>
                    {entry.work_description}
                  </div>
                  <div style={{ fontSize: '8pt', color: '#6b7280', marginBottom: '4px' }}>
                    {entry.date_performed} • {entry.mileage.toLocaleString()} mi
                  </div>
                  {entry.parts_used && (
                    <div style={{ fontSize: '8pt', color: '#374151', marginBottom: '2px' }}>
                      Parts: {entry.parts_used}
                    </div>
                  )}
                  {entry.materials_used && (
                    <div style={{ fontSize: '8pt', color: '#374151', marginBottom: '2px' }}>
                      Materials: {entry.materials_used}
                    </div>
                  )}
                  {entry.notes && (
                    <div style={{ fontSize: '8pt', color: '#6b7280' }}>
                      {entry.notes}
                    </div>
                  )}
                </div>
                
                <div style={{ textAlign: 'right', minWidth: '80px' }}>
                  <div style={{ fontSize: '8pt', fontWeight: 'bold' }}>
                    ${entry.total_cost.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '8pt', color: '#6b7280' }}>
                    {entry.labor_hours}h
                  </div>
                  {entry.has_receipts && (
                    <div style={{ fontSize: '8pt', color: '#059669' }}>
                      Receipts
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {workEntries.length > 0 && (
          <div style={{ 
            padding: '8px', 
            borderTop: '1px solid #e5e7eb', 
            backgroundColor: '#f9fafb',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '8pt'
          }}>
            <span>Total Work: {workEntries.length} entries</span>
            <span>Total Cost: ${workEntries.reduce((sum, e) => sum + e.total_cost, 0).toFixed(2)}</span>
            <span>Total Hours: {workEntries.reduce((sum, e) => sum + e.labor_hours, 0).toFixed(1)}h</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkDocumentationPanel;
