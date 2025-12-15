import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface AddDepartmentModalProps {
  shopId: string;
  isOpen: boolean;
  onClose: (created?: boolean) => void;
}

const modalStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
};
const panelStyle: React.CSSProperties = {
  width: '560px', maxWidth: '95%', background: 'var(--surface)', border: '1px solid #c0c0c0', borderRadius: 2
};
const headerStyle: React.CSSProperties = { padding: 6, borderBottom: '1px solid #c0c0c0', background: 'var(--bg)', fontWeight: 700 };
const bodyStyle: React.CSSProperties = { padding: 8 };

const TYPES = ['sales','consignment','service','parts','body_shop','detailing','showroom','warehouse','transport','admin','finance','marketing','custom'] as const;

const AddDepartmentModal: React.FC<AddDepartmentModalProps> = ({ shopId, isOpen, onClose }) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<typeof TYPES[number]>('service');
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('shop_locations')
          .select('id, name')
          .eq('shop_id', shopId)
          .order('is_headquarters', { ascending: false })
          .order('name', { ascending: true });
        if (error) throw error;
        setLocations((data as any[]) || []);
      } catch {
        setLocations([]);
      }
    })();
  }, [shopId, isOpen]);

  if (!isOpen) return null;

  const submit = async () => {
    if (!name.trim()) return;
    try {
      setLoading(true);
      const { error } = await supabase.from('shop_departments').insert({
        shop_id: shopId,
        name: name.trim(),
        department_type: type,
        location_id: locationId || null
      } as any);
      if (error) throw error;
      onClose(true);
    } catch (e: any) {
      alert(`Add department failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={modalStyle} onClick={() => onClose()}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>Add Department</div>
        <div style={bodyStyle}>
          <div style={{ display:'grid', gap:6 }}>
            <input className="form-input" placeholder="Department name" value={name} onChange={e=>setName(e.target.value)} />
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <select className="form-input" value={type} onChange={e=>setType(e.target.value as any)}>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="form-input" value={locationId} onChange={e=>setLocationId(e.target.value)}>
                <option value="">No location</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:6, marginTop:8 }}>
            <button className="button button-small button-secondary" onClick={()=>onClose()} disabled={loading}>Cancel</button>
            <button className="button button-small" onClick={submit} disabled={loading || !name.trim()}>{loading ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddDepartmentModal;


