import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface ShopStructureBuilderProps {
  shopId: string;
  shopName: string;
  orgType: string;
}

export const ShopStructureBuilder: React.FC<ShopStructureBuilderProps> = ({ shopId, shopName, orgType }) => {
  const [tab, setTab] = useState<'locations' | 'licenses' | 'departments' | 'staff'>('locations');
  const [locations, setLocations] = useState<any[]>([]);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [presets, setPresets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [shopId, tab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'locations') {
        const { data } = await supabase
          .from('shop_locations')
          .select('*')
          .eq('shop_id', shopId)
          .order('is_headquarters', { ascending: false });
        setLocations(data || []);
      } else if (tab === 'licenses') {
        const { data } = await supabase
          .from('shop_licenses')
          .select('*, shop_locations(name)')
          .eq('shop_id', shopId)
          .order('created_at', { ascending: false });
        setLicenses(data || []);
      } else if (tab === 'departments') {
        const { data } = await supabase
          .from('shop_departments')
          .select('*, shop_locations(name)')
          .eq('shop_id', shopId)
          .order('created_at', { ascending: false });
        setDepartments(data || []);
        
        const { data: presetData } = await supabase
          .from('department_presets')
          .select('*')
          .eq('business_type', orgType)
          .eq('is_recommended', true)
          .order('sort_order');
        setPresets(presetData || []);
      } else if (tab === 'staff') {
        const { data } = await supabase
          .from('shop_members')
          .select('*, shop_departments(name)')
          .eq('shop_id', shopId)
          .eq('status', 'active')
          .order('created_at', { ascending: false });
        setMembers(data || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const addLocation = async (formData: any) => {
    const { error } = await supabase.from('shop_locations').insert({
      shop_id: shopId,
      ...formData
    });
    if (!error) {
      loadData();
      return true;
    }
    return false;
  };

  const addLicense = async (formData: any) => {
    const { error } = await supabase.from('shop_licenses').insert({
      shop_id: shopId,
      ...formData
    });
    if (!error) {
      loadData();
      return true;
    }
    return false;
  };

  const addDepartment = async (formData: any) => {
    const { error } = await supabase.from('shop_departments').insert({
      shop_id: shopId,
      ...formData
    });
    if (!error) {
      loadData();
      return true;
    }
    return false;
  };

  const createDefaultDepartments = async (locationId: string) => {
    const { error } = await supabase.rpc('create_default_departments', {
      p_shop_id: shopId,
      p_location_id: locationId,
      p_business_type: orgType
    });
    
    if (!error) {
      alert('✅ Default departments created!');
      loadData();
    } else {
      alert('Error creating departments');
    }
  };

  return (
    <div style={{ padding: '24px' }}>
      <h2 style={{ marginBottom: '24px', fontSize: '24px', fontWeight: '600' }}>
        {shopName} - Business Structure
      </h2>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '2px solid #e5e7eb', marginBottom: '24px' }}>
        {(['locations', 'licenses', 'departments', 'staff'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '12px 24px',
              border: 'none',
              borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer',
              fontWeight: tab === t ? '600' : '400',
              color: tab === t ? '#3b82f6' : '#6b7280',
              marginBottom: '-2px',
              textTransform: 'capitalize'
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content based on active tab */}
      <div>
        {tab === 'locations' && (
          <LocationsTab 
            locations={locations} 
            onAdd={addLocation} 
            onCreateDepartments={createDefaultDepartments}
          />
        )}
        {tab === 'licenses' && (
          <LicensesTab 
            licenses={licenses} 
            locations={locations}
            onAdd={addLicense} 
          />
        )}
        {tab === 'departments' && (
          <DepartmentsTab 
            departments={departments} 
            locations={locations}
            presets={presets}
            onAdd={addDepartment} 
          />
        )}
        {tab === 'staff' && (
          <StaffTab members={members} departments={departments} />
        )}
      </div>
    </div>
  );
};

// Sub-components for each tab
const LocationsTab = ({ locations, onAdd, onCreateDepartments }: any) => {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    street_address: '',
    city: '',
    state: '',
    postal_code: '',
    is_headquarters: false
  });

  const handleSubmit = async () => {
    const success = await onAdd(form);
    if (success) {
      setShowForm(false);
      setForm({ name: '', street_address: '', city: '', state: '', postal_code: '', is_headquarters: false });
    }
  };

  return (
    <div>
      <button 
        onClick={() => setShowForm(!showForm)}
        style={{ marginBottom: '16px', padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
      >
        {showForm ? 'Cancel' : '+ Add Location'}
      </button>

      {showForm && (
        <div style={{ marginBottom: '24px', padding: '20px', border: '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: 'white' }}>
          <h3 style={{ marginBottom: '16px', fontWeight: '600' }}>New Location</h3>
          <input
            placeholder="Location Name (e.g., 707 Yucca St HQ)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            style={{ width: '100%', padding: '8px', marginBottom: '12px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
          />
          <input
            placeholder="Street Address"
            value={form.street_address}
            onChange={(e) => setForm({ ...form, street_address: e.target.value })}
            style={{ width: '100%', padding: '8px', marginBottom: '12px', border: '1px solid #e5e7eb', borderRadius: '6px' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} style={{ padding: '8px', border: '1px solid #e5e7eb', borderRadius: '6px' }} />
            <input placeholder="State" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} style={{ padding: '8px', border: '1px solid #e5e7eb', borderRadius: '6px' }} />
            <input placeholder="ZIP" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} style={{ padding: '8px', border: '1px solid #e5e7eb', borderRadius: '6px' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
            <input type="checkbox" checked={form.is_headquarters} onChange={(e) => setForm({ ...form, is_headquarters: e.target.checked })} style={{ marginRight: '8px' }} />
            This is the headquarters
          </label>
          <button onClick={handleSubmit} style={{ padding: '8px 16px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
            Create Location
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gap: '16px' }}>
        {locations.map((loc: any) => (
          <div key={loc.id} style={{ padding: '16px', border: '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <h4 style={{ fontWeight: '600', marginBottom: '4px' }}>
                  {loc.name}
                  {loc.is_headquarters && <span style={{ marginLeft: '8px', padding: '2px 8px', backgroundColor: '#dbeafe', color: '#1e40af', borderRadius: '4px', fontSize: '12px', fontWeight: '500' }}>HQ</span>}
                </h4>
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>
                  {loc.street_address}<br />
                  {loc.city}, {loc.state} {loc.postal_code}
                </p>
              </div>
              <button
                onClick={() => onCreateDepartments(loc.id)}
                style={{ padding: '6px 12px', fontSize: '14px', backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer' }}
              >
                Add Default Departments
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const LicensesTab = ({ licenses, locations, onAdd }: any) => (
  <div>
    <p style={{ marginBottom: '16px', color: '#6b7280' }}>
      Manage business licenses (dealer, garage, etc.)
    </p>
    {licenses.length === 0 ? (
      <div style={{ padding: '48px', textAlign: 'center', color: '#6b7280', border: '1px dashed #e5e7eb', borderRadius: '8px' }}>
        No licenses added yet
      </div>
    ) : (
      <div style={{ display: 'grid', gap: '16px' }}>
        {licenses.map((lic: any) => (
          <div key={lic.id} style={{ padding: '16px', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
            <div style={{ fontWeight: '600' }}>{lic.license_type.replace(/_/g, ' ')}</div>
            <div style={{ fontSize: '14px', color: '#6b7280' }}>
              #{lic.license_number} • {lic.shop_locations?.name}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

const DepartmentsTab = ({ departments, locations, presets, onAdd }: any) => (
  <div>
    {presets.length > 0 && (
      <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px' }}>
        <h4 style={{ fontWeight: '600', marginBottom: '8px' }}>Recommended Departments:</h4>
        <div style={{ fontSize: '14px', color: '#374151' }}>
          {presets.map((p: any) => p.preset_name).join(', ')}
        </div>
      </div>
    )}
    <div style={{ display: 'grid', gap: '16px' }}>
      {departments.map((dept: any) => (
        <div key={dept.id} style={{ padding: '16px', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
          <div style={{ fontWeight: '600' }}>{dept.name}</div>
          <div style={{ fontSize: '14px', color: '#6b7280' }}>
            {dept.department_type.replace(/_/g, ' ')} • {dept.shop_locations?.name}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const StaffTab = ({ members, departments }: any) => (
  <div>
    <div style={{ display: 'grid', gap: '16px' }}>
      {members.map((member: any) => (
        <div key={member.id} style={{ padding: '16px', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
          <div style={{ fontWeight: '600' }}>{member.user_id}</div>
          <div style={{ fontSize: '14px', color: '#6b7280' }}>
            {member.role} • {member.shop_departments?.name || 'No department'}
          </div>
        </div>
      ))}
    </div>
  </div>
);
