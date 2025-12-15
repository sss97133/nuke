import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
// import * as XLSX from 'xlsx'; // Optional dependency - install with: npm install xlsx

interface BulkVehicle {
  id?: string;
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  mileage?: number;
  color?: string;
  asking_price?: number;
  purchase_price?: number;
  cost_basis?: number;
  notes?: string;
  status?: 'draft' | 'in_stock' | 'sold' | 'pending';
  _errors?: string[];
  _isNew?: boolean;
  _isDirty?: boolean;
}

const DealerBulkEditor: React.FC = () => {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [vehicles, setVehicles] = useState<BulkVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [organization, setOrganization] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [aiParsing, setAiParsing] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    if (orgId && session) {
      loadOrganization();
      loadInventory();
    }
  }, [orgId, session]);

  const loadSession = async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    setSession(s);
  };

  const loadOrganization = async () => {
    const { data } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', orgId)
      .single();
    setOrganization(data);
  };

  const loadInventory = async () => {
    setLoading(true);
    try {
      // Load existing inventory
      const { data } = await supabase
        .from('organization_vehicles')
        .select(`
          vehicle_id,
          relationship_type,
          vehicles!inner(
            id,
            vin,
            year,
            make,
            model,
            trim,
            mileage,
            color_primary,
            asking_price,
            purchase_price,
            cost_basis,
            notes
          )
        `)
        .eq('organization_id', orgId)
        .in('relationship_type', ['in_stock', 'consignment', 'owner']);

      const mapped = data?.map((row: any) => ({
        id: row.vehicles.id,
        vin: row.vehicles.vin,
        year: row.vehicles.year,
        make: row.vehicles.make,
        model: row.vehicles.model,
        trim: row.vehicles.trim,
        mileage: row.vehicles.mileage,
        color: row.vehicles.color_primary,
        asking_price: row.vehicles.asking_price,
        purchase_price: row.vehicles.purchase_price,
        cost_basis: row.vehicles.cost_basis,
        notes: row.vehicles.notes,
        status: row.relationship_type,
        _isNew: false,
        _isDirty: false,
        _errors: []
      })) || [];

      setVehicles(mapped);
    } catch (error) {
      console.error('Failed to load inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  const addNewRow = () => {
    setVehicles([
      ...vehicles,
      {
        _isNew: true,
        _isDirty: true,
        _errors: [],
        status: 'draft'
      }
    ]);
  };

  const updateCell = (index: number, field: keyof BulkVehicle, value: any) => {
    const updated = [...vehicles];
    updated[index] = {
      ...updated[index],
      [field]: value,
      _isDirty: true
    };
    setVehicles(updated);
  };

  const validateRow = (vehicle: BulkVehicle): string[] => {
    const errors: string[] = [];
    
    if (!vehicle.year || vehicle.year < 1900 || vehicle.year > new Date().getFullYear() + 2) {
      errors.push('Invalid year');
    }
    if (!vehicle.make || vehicle.make.trim() === '') {
      errors.push('Make required');
    }
    if (!vehicle.model || vehicle.model.trim() === '') {
      errors.push('Model required');
    }
    if (vehicle.vin && vehicle.vin.length !== 17) {
      errors.push('VIN must be 17 characters');
    }
    
    return errors;
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const dirtyVehicles = vehicles.filter(v => v._isDirty);
      
      for (const vehicle of dirtyVehicles) {
        const errors = validateRow(vehicle);
        if (errors.length > 0) {
          vehicle._errors = errors;
          continue;
        }

        if (vehicle._isNew) {
          // Insert new vehicle
          const { data: newVehicle, error: vError } = await supabase
            .from('vehicles')
            .insert({
              vin: vehicle.vin,
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              trim: vehicle.trim,
              mileage: vehicle.mileage,
              color_primary: vehicle.color,
              asking_price: vehicle.asking_price,
              purchase_price: vehicle.purchase_price,
              cost_basis: vehicle.cost_basis,
              notes: vehicle.notes,
              uploaded_by: session?.user?.id,
              is_public: true
            })
            .select()
            .single();

          if (vError) {
            vehicle._errors = [vError.message];
            continue;
          }

          // Link to organization
          await supabase
            .from('organization_vehicles')
            .insert({
              organization_id: orgId,
              vehicle_id: newVehicle.id,
              relationship_type: vehicle.status || 'in_stock'
            });

          vehicle.id = newVehicle.id;
          vehicle._isNew = false;
        } else {
          // Update existing vehicle
          const { error: uError } = await supabase
            .from('vehicles')
            .update({
              vin: vehicle.vin,
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              trim: vehicle.trim,
              mileage: vehicle.mileage,
              color_primary: vehicle.color,
              asking_price: vehicle.asking_price,
              purchase_price: vehicle.purchase_price,
              cost_basis: vehicle.cost_basis,
              notes: vehicle.notes
            })
            .eq('id', vehicle.id);

          if (uError) {
            vehicle._errors = [uError.message];
            continue;
          }
        }

        vehicle._isDirty = false;
        vehicle._errors = [];
      }

      setVehicles([...vehicles]);
      alert('Saved successfully!');
    } catch (error: any) {
      alert('Save failed: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const parseSpreadsheet = async () => {
    if (!selectedFile) return;
    
    setAiParsing(true);
    try {
      // Dynamic import to avoid build errors if xlsx is not installed
      const XLSX = await import('xlsx');
      
      const reader = new FileReader();
      reader.onload = async (e) => {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet);

        // Send to AI for parsing
        const { data: parsed, error } = await supabase.functions.invoke('parse-dealer-spreadsheet', {
          body: { 
            spreadsheet: json,
            organizationId: orgId
          }
        });

        if (error) throw error;

        // Add parsed vehicles to the grid
        const newVehicles = parsed.vehicles.map((v: any) => ({
          ...v,
          _isNew: true,
          _isDirty: true,
          _errors: [],
          status: 'draft'
        }));

        setVehicles([...vehicles, ...newVehicles]);
        alert(`Parsed ${newVehicles.length} vehicles from spreadsheet!`);
      };
      reader.readAsBinaryString(selectedFile);
    } catch (error: any) {
      alert('Failed to parse spreadsheet: ' + error.message);
    } finally {
      setAiParsing(false);
    }
  };

  const deleteRow = (index: number) => {
    if (confirm('Delete this vehicle?')) {
      const updated = [...vehicles];
      updated.splice(index, 1);
      setVehicles(updated);
    }
  };

  if (!session) {
    return <div style={{ padding: '20px' }}>Please log in</div>;
  }

  return (
    <div style={{ 
      padding: '20px',
      background: 'var(--surface)',
      minHeight: '100vh'
    }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <div>
          <h1 style={{ fontSize: '14pt', fontWeight: 700, margin: 0 }}>
            Dealer Bulk Editor
          </h1>
          <p style={{ fontSize: '8pt', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
            {organization?.business_name || 'Loading...'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => navigate(`/org/${orgId}`)}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              cursor: 'pointer'
            }}
          >
            Back to Profile
          </button>
          <button
            onClick={addNewRow}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              border: '1px solid var(--accent)',
              background: 'var(--accent)',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            + Add Row
          </button>
          <button
            onClick={saveAll}
            disabled={saving}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              border: '1px solid var(--success)',
              background: 'var(--success)',
              color: 'white',
              cursor: saving ? 'wait' : 'pointer',
              fontWeight: 600,
              opacity: saving ? 0.6 : 1
            }}
          >
            {saving ? 'Saving...' : 'Save All Changes'}
          </button>
        </div>
      </div>

      {/* AI Spreadsheet Import */}
      <div style={{
        background: 'var(--surface)',
        border: '2px solid var(--accent)',
        borderRadius: '4px',
        padding: '16px',
        marginBottom: '20px'
      }}>
        <h3 style={{ fontSize: '10pt', fontWeight: 700, margin: '0 0 12px 0' }}>
          AI Spreadsheet Parser
        </h3>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileSelect}
            style={{ fontSize: '8pt' }}
          />
          {selectedFile && (
            <button
              onClick={parseSpreadsheet}
              disabled={aiParsing}
              style={{
                padding: '6px 12px',
                fontSize: '8pt',
                border: '1px solid var(--accent)',
                background: 'var(--accent)',
                color: 'white',
                cursor: aiParsing ? 'wait' : 'pointer',
                fontWeight: 600
              }}
            >
              {aiParsing ? 'Parsing...' : 'Parse with AI'}
            </button>
          )}
        </div>
        <p style={{ fontSize: '7pt', color: 'var(--text-muted)', margin: '8px 0 0 0' }}>
          Upload your dealer inventory spreadsheet. AI will automatically map columns to fields.
        </p>
      </div>

      {/* Spreadsheet Grid */}
      <div style={{ 
        overflowX: 'auto',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '4px'
      }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '8pt'
        }}>
          <thead>
            <tr style={{ background: 'var(--grey-50)' }}>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '40px' }}>#</th>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '150px' }}>VIN</th>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '60px' }}>Year</th>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '100px' }}>Make</th>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '100px' }}>Model</th>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '100px' }}>Trim</th>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '80px' }}>Mileage</th>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '80px' }}>Color</th>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '100px' }}>Asking $</th>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '100px' }}>Purchase $</th>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '100px' }}>Cost Basis $</th>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '100px' }}>Status</th>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '200px' }}>Notes</th>
              <th style={{ padding: '8px', border: '1px solid var(--border)', width: '60px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={14} style={{ padding: '20px', textAlign: 'center' }}>
                  Loading inventory...
                </td>
              </tr>
            )}
            {!loading && vehicles.length === 0 && (
              <tr>
                <td colSpan={14} style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No vehicles yet. Click "Add Row" to start.
                </td>
              </tr>
            )}
            {vehicles.map((vehicle, index) => (
              <tr 
                key={vehicle.id || index}
                style={{
                  background: vehicle._isDirty ? 'rgba(255, 220, 100, 0.1)' : 'white',
                  borderLeft: vehicle._errors && vehicle._errors.length > 0 ? '3px solid var(--danger)' : 'none'
                }}
              >
                <td style={{ padding: '4px', border: '1px solid var(--border)', textAlign: 'center' }}>
                  {index + 1}
                </td>
                <td style={{ padding: '4px', border: '1px solid var(--border)' }}>
                  <input
                    type="text"
                    value={vehicle.vin || ''}
                    onChange={(e) => updateCell(index, 'vin', e.target.value.toUpperCase())}
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)',
                      fontFamily: 'monospace'
                    }}
                    placeholder="17-char VIN"
                    maxLength={17}
                  />
                </td>
                <td style={{ padding: '4px', border: '1px solid var(--border)' }}>
                  <input
                    type="number"
                    value={vehicle.year || ''}
                    onChange={(e) => updateCell(index, 'year', parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)'
                    }}
                    placeholder="2024"
                  />
                </td>
                <td style={{ padding: '4px', border: '1px solid var(--border)' }}>
                  <input
                    type="text"
                    value={vehicle.make || ''}
                    onChange={(e) => updateCell(index, 'make', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)'
                    }}
                    placeholder="Chevrolet"
                  />
                </td>
                <td style={{ padding: '4px', border: '1px solid var(--border)' }}>
                  <input
                    type="text"
                    value={vehicle.model || ''}
                    onChange={(e) => updateCell(index, 'model', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)'
                    }}
                    placeholder="Silverado"
                  />
                </td>
                <td style={{ padding: '4px', border: '1px solid var(--border)' }}>
                  <input
                    type="text"
                    value={vehicle.trim || ''}
                    onChange={(e) => updateCell(index, 'trim', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)'
                    }}
                    placeholder="LT"
                  />
                </td>
                <td style={{ padding: '4px', border: '1px solid var(--border)' }}>
                  <input
                    type="number"
                    value={vehicle.mileage || ''}
                    onChange={(e) => updateCell(index, 'mileage', parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)'
                    }}
                    placeholder="50000"
                  />
                </td>
                <td style={{ padding: '4px', border: '1px solid var(--border)' }}>
                  <input
                    type="text"
                    value={vehicle.color || ''}
                    onChange={(e) => updateCell(index, 'color', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)'
                    }}
                    placeholder="Black"
                  />
                </td>
                <td style={{ padding: '4px', border: '1px solid var(--border)' }}>
                  <input
                    type="number"
                    value={vehicle.asking_price || ''}
                    onChange={(e) => updateCell(index, 'asking_price', parseFloat(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)'
                    }}
                    placeholder="45000"
                  />
                </td>
                <td style={{ padding: '4px', border: '1px solid var(--border)' }}>
                  <input
                    type="number"
                    value={vehicle.purchase_price || ''}
                    onChange={(e) => updateCell(index, 'purchase_price', parseFloat(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)'
                    }}
                    placeholder="38000"
                  />
                </td>
                <td style={{ padding: '4px', border: '1px solid var(--border)' }}>
                  <input
                    type="number"
                    value={vehicle.cost_basis || ''}
                    onChange={(e) => updateCell(index, 'cost_basis', parseFloat(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)'
                    }}
                    placeholder="40000"
                  />
                </td>
                <td style={{ padding: '4px', border: '1px solid var(--border)' }}>
                  <select
                    value={vehicle.status || 'draft'}
                    onChange={(e) => updateCell(index, 'status', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <option value="draft">Draft</option>
                    <option value="in_stock">In Stock</option>
                    <option value="sold">Sold</option>
                    <option value="pending">Pending</option>
                  </select>
                </td>
                <td style={{ padding: '4px', border: '1px solid var(--border)' }}>
                  <input
                    type="text"
                    value={vehicle.notes || ''}
                    onChange={(e) => updateCell(index, 'notes', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)'
                    }}
                    placeholder="Notes..."
                  />
                </td>
                <td style={{ padding: '4px', border: '1px solid var(--border)', textAlign: 'center' }}>
                  <button
                    onClick={() => deleteRow(index)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '7pt',
                      border: '1px solid var(--danger)',
                      background: 'var(--surface)',
                      color: 'var(--danger)',
                      cursor: 'pointer'
                    }}
                  >
                    DEL
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Error Summary */}
      {vehicles.some(v => v._errors && v._errors.length > 0) && (
        <div style={{
          marginTop: '20px',
          padding: '12px',
          background: 'rgba(255, 0, 0, 0.1)',
          border: '1px solid var(--danger)',
          borderRadius: '4px'
        }}>
          <h4 style={{ fontSize: '9pt', fontWeight: 700, margin: '0 0 8px 0', color: 'var(--danger)' }}>
            Validation Errors
          </h4>
          {vehicles.map((v, i) => (
            v._errors && v._errors.length > 0 && (
              <div key={i} style={{ fontSize: '8pt', marginBottom: '4px' }}>
                Row {i + 1}: {v._errors.join(', ')}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
};

export default DealerBulkEditor;

