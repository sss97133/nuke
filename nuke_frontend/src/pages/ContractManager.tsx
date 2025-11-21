import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Contract {
  id: string;
  contract_type: string;
  client_name: string | null;
  vehicle_name: string | null;
  agreed_labor_rate: number | null;
  agreed_parts_markup: number | null;
  payment_terms: string | null;
  start_date: string;
  end_date: string | null;
  status: string;
  budget_cap: number | null;
  waived_fees: string[] | null;
}

const ContractManager: React.FC = () => {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  
  const [formData, setFormData] = useState({
    client_id: '',
    vehicle_id: '',
    contract_type: 'one_time',
    agreed_labor_rate: '',
    agreed_parts_markup: '',
    payment_terms: 'Due on completion',
    payment_schedule: '',
    budget_cap: '',
    waived_fees: [] as string[],
    start_date: new Date().toISOString().split('T')[0],
    end_date: ''
  });

  useEffect(() => {
    loadContracts();
    loadClients();
    loadVehicles();
  }, []);

  const loadContracts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('work_contracts')
        .select(`
          id,
          contract_type,
          agreed_labor_rate,
          agreed_parts_markup,
          payment_terms,
          start_date,
          end_date,
          status,
          budget_cap,
          waived_fees,
          client:clients(client_name),
          vehicle:vehicles(year, make, model, series)
        `)
        .order('start_date', { ascending: false });

      if (error) throw error;

      const formatted = (data || []).map((c: any) => ({
        id: c.id,
        contract_type: c.contract_type,
        client_name: c.client?.client_name || null,
        vehicle_name: c.vehicle 
          ? `${c.vehicle.year} ${c.vehicle.make} ${c.vehicle.model}${c.vehicle.series ? ' ' + c.vehicle.series : ''}`
          : null,
        agreed_labor_rate: c.agreed_labor_rate ? parseFloat(c.agreed_labor_rate) : null,
        agreed_parts_markup: c.agreed_parts_markup ? parseFloat(c.agreed_parts_markup) : null,
        payment_terms: c.payment_terms,
        start_date: c.start_date,
        end_date: c.end_date,
        status: c.status,
        budget_cap: c.budget_cap ? parseFloat(c.budget_cap) : null,
        waived_fees: c.waived_fees
      }));

      setContracts(formatted);
    } catch (error) {
      console.error('Error loading contracts:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadClients = async () => {
    const { data } = await supabase.from('clients').select('id, client_name, company_name').order('client_name');
    setClients(data || []);
  };

  const loadVehicles = async () => {
    const { data } = await supabase.from('vehicles').select('id, year, make, model, series').order('year', { ascending: false });
    setVehicles(data || []);
  };

  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase.from('work_contracts').insert({
        client_id: formData.client_id || null,
        vehicle_id: formData.vehicle_id || null,
        contract_type: formData.contract_type,
        agreed_labor_rate: formData.agreed_labor_rate ? parseFloat(formData.agreed_labor_rate) : null,
        agreed_parts_markup: formData.agreed_parts_markup ? parseFloat(formData.agreed_parts_markup) : null,
        payment_terms: formData.payment_terms,
        payment_schedule: formData.payment_schedule || null,
        budget_cap: formData.budget_cap ? parseFloat(formData.budget_cap) : null,
        waived_fees: formData.waived_fees,
        start_date: formData.start_date,
        end_date: formData.end_date || null,
        status: 'active'
      });

      if (error) throw error;

      setShowCreateForm(false);
      loadContracts();
      
      // Reset form
      setFormData({
        client_id: '',
        vehicle_id: '',
        contract_type: 'one_time',
        agreed_labor_rate: '',
        agreed_parts_markup: '',
        payment_terms: 'Due on completion',
        payment_schedule: '',
        budget_cap: '',
        waived_fees: [],
        start_date: new Date().toISOString().split('T')[0],
        end_date: ''
      });
    } catch (error) {
      console.error('Error creating contract:', error);
      alert('Failed to create contract');
    }
  };

  const toggleWaivedFee = (fee: string) => {
    setFormData(prev => ({
      ...prev,
      waived_fees: prev.waived_fees.includes(fee)
        ? prev.waived_fees.filter(f => f !== fee)
        : [...prev.waived_fees, fee]
    }));
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'var(--success)';
      case 'completed': return 'var(--text-secondary)';
      case 'terminated': return 'var(--error)';
      case 'expired': return 'var(--warning)';
      default: return 'var(--text)';
    }
  };

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', padding: 'var(--space-4)' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ 
          marginBottom: 'var(--space-4)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h1 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            Contract Manager
          </h1>
          
          <button
            onClick={() => setShowCreateForm(true)}
            style={{
              padding: '6px var(--space-3)',
              border: '2px solid var(--text)',
              background: 'var(--text)',
              color: 'var(--surface)',
              fontSize: '9px',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: 'var(--radius)'
            }}
          >
            CREATE CONTRACT
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)', fontSize: '10px' }}>
            Loading contracts...
          </div>
        ) : contracts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '10px', marginBottom: 'var(--space-3)' }}>
              No contracts yet
            </div>
            <button
              onClick={() => setShowCreateForm(true)}
              style={{
                padding: '6px var(--space-3)',
                border: '2px solid var(--text)',
                background: 'var(--text)',
                color: 'var(--surface)',
                fontSize: '9px',
                fontWeight: 700,
                cursor: 'pointer',
                borderRadius: 'var(--radius)'
              }}
            >
              CREATE FIRST CONTRACT
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {contracts.map(contract => (
              <div
                key={contract.id}
                style={{
                  background: 'var(--surface)',
                  border: '2px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-3)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
                  <div>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>
                      {contract.client_name || 'General Contract'}
                      {contract.vehicle_name && (
                        <span style={{ 
                          marginLeft: 'var(--space-2)',
                          fontWeight: 600,
                          color: 'var(--text-secondary)'
                        }}>
                          • {contract.vehicle_name}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '8px', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                      {contract.contract_type.replace('_', ' ')}
                    </div>
                  </div>
                  <div style={{
                    fontSize: '8px',
                    fontWeight: 700,
                    color: getStatusColor(contract.status),
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    border: `1px solid ${getStatusColor(contract.status)}`,
                    borderRadius: '2px'
                  }}>
                    {contract.status}
                  </div>
                </div>

                <div style={{ 
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 'var(--space-3)',
                  fontSize: '9px'
                }}>
                  {contract.agreed_labor_rate && (
                    <div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '8px' }}>Labor Rate</div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                        {formatCurrency(contract.agreed_labor_rate)}/hr
                      </div>
                    </div>
                  )}
                  {contract.agreed_parts_markup && (
                    <div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '8px' }}>Parts Markup</div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                        {contract.agreed_parts_markup}%
                      </div>
                    </div>
                  )}
                  {contract.payment_terms && (
                    <div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '8px' }}>Payment Terms</div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                        {contract.payment_terms}
                      </div>
                    </div>
                  )}
                  {contract.budget_cap && (
                    <div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '8px' }}>Budget Cap</div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                        {formatCurrency(contract.budget_cap)}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '8px' }}>Period</div>
                    <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                      {new Date(contract.start_date).toLocaleDateString()}
                      {contract.end_date && ` - ${new Date(contract.end_date).toLocaleDateString()}`}
                    </div>
                  </div>
                </div>

                {contract.waived_fees && contract.waived_fees.length > 0 && (
                  <div style={{ 
                    marginTop: 'var(--space-2)',
                    padding: 'var(--space-2)',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: '8px'
                  }}>
                    <span style={{ fontWeight: 700 }}>Waived Fees:</span> {contract.waived_fees.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Contract Modal */}
      {showCreateForm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 'var(--space-4)'
          }}
          onClick={() => setShowCreateForm(false)}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '2px solid var(--border)',
              borderRadius: 'var(--radius)',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: 'var(--space-4)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginBottom: 'var(--space-3)' }}>
              Create New Contract
            </h2>

            <form onSubmit={handleCreateContract} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                  Client
                </label>
                <select
                  value={formData.client_id}
                  onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
                  style={{
                    width: '100%',
                    padding: 'var(--space-2)',
                    border: '2px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: '9px',
                    background: 'var(--bg)',
                    color: 'var(--text)'
                  }}
                >
                  <option value="">Any client (general contract)</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.client_name}{c.company_name ? ` - ${c.company_name}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                  Vehicle (Optional)
                </label>
                <select
                  value={formData.vehicle_id}
                  onChange={(e) => setFormData({ ...formData, vehicle_id: e.target.value })}
                  style={{
                    width: '100%',
                    padding: 'var(--space-2)',
                    border: '2px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: '9px',
                    background: 'var(--bg)',
                    color: 'var(--text)'
                  }}
                >
                  <option value="">Any vehicle</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.year} {v.make} {v.model} {v.series || ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                  Contract Type
                </label>
                <select
                  value={formData.contract_type}
                  onChange={(e) => setFormData({ ...formData, contract_type: e.target.value })}
                  style={{
                    width: '100%',
                    padding: 'var(--space-2)',
                    border: '2px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: '9px',
                    background: 'var(--bg)',
                    color: 'var(--text)'
                  }}
                >
                  <option value="one_time">One-time Job</option>
                  <option value="ongoing">Ongoing Service</option>
                  <option value="project_based">Project-based</option>
                  <option value="retainer">Retainer</option>
                  <option value="warranty_work">Warranty Work</option>
                  <option value="insurance_claim">Insurance Claim</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Labor Rate ($/hr)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.agreed_labor_rate}
                    onChange={(e) => setFormData({ ...formData, agreed_labor_rate: e.target.value })}
                    placeholder="Leave empty for default"
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Parts Markup (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.agreed_parts_markup}
                    onChange={(e) => setFormData({ ...formData, agreed_parts_markup: e.target.value })}
                    placeholder="Leave empty for default"
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)'
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                  Payment Terms
                </label>
                <select
                  value={formData.payment_terms}
                  onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })}
                  style={{
                    width: '100%',
                    padding: 'var(--space-2)',
                    border: '2px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: '9px',
                    background: 'var(--bg)',
                    color: 'var(--text)'
                  }}
                >
                  <option value="Due on completion">Due on completion</option>
                  <option value="Net 7">Net 7</option>
                  <option value="Net 15">Net 15</option>
                  <option value="Net 30">Net 30</option>
                  <option value="Net 60">Net 60</option>
                  <option value="50/50">50% deposit, 50% on completion</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                  Budget Cap (Optional)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.budget_cap}
                  onChange={(e) => setFormData({ ...formData, budget_cap: e.target.value })}
                  placeholder="Max total cost"
                  style={{
                    width: '100%',
                    padding: 'var(--space-2)',
                    border: '2px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: '9px',
                    background: 'var(--bg)',
                    color: 'var(--text)'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    required
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                    End Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      border: '2px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      fontSize: '9px',
                      background: 'var(--bg)',
                      color: 'var(--text)'
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '9px', fontWeight: 700, marginBottom: 'var(--space-1)', color: 'var(--text)' }}>
                  Waive Fees
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                  {['shop_fee', 'environmental_fee', 'hazmat_fee', 'equipment_fee'].map(fee => (
                    <label key={fee} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={formData.waived_fees.includes(fee)}
                        onChange={() => toggleWaivedFee(fee)}
                      />
                      {fee.replace('_', ' ')}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <button
                  type="submit"
                  style={{
                    flex: 1,
                    padding: '6px var(--space-3)',
                    border: '2px solid var(--text)',
                    background: 'var(--text)',
                    color: 'var(--surface)',
                    fontSize: '9px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    borderRadius: 'var(--radius)'
                  }}
                >
                  CREATE CONTRACT
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  style={{
                    flex: 1,
                    padding: '6px var(--space-3)',
                    border: '2px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    fontSize: '9px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    borderRadius: 'var(--radius)'
                  }}
                >
                  CANCEL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ContractManager;

