import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface AddLocationModalProps {
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

const AddLocationModal: React.FC<AddLocationModalProps> = ({ shopId, isOpen, onClose }) => {
  const [name, setName] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postal, setPostal] = useState('');
  const [isHQ, setIsHQ] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const submit = async () => {
    if (!name.trim()) return;
    try {
      setLoading(true);
      const { error } = await supabase.from('shop_locations').insert({
        shop_id: shopId,
        name: name.trim(),
        is_headquarters: isHQ,
        street_address: street || null,
        city: city || null,
        state: state || null,
        postal_code: postal || null
      } as any);
      if (error) throw error;
      onClose(true);
    } catch (e: any) {
      alert(`Add location failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={modalStyle} onClick={() => onClose()}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>Add Location</div>
        <div style={bodyStyle}>
          <div style={{ display:'grid', gap:6 }}>
            <input className="form-input" placeholder="Location name" value={name} onChange={e=>setName(e.target.value)} />
            <input className="form-input" placeholder="Street address" value={street} onChange={e=>setStreet(e.target.value)} />
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <input className="form-input" placeholder="City" value={city} onChange={e=>setCity(e.target.value)} />
              <input className="form-input" placeholder="State" value={state} onChange={e=>setState(e.target.value)} />
              <input className="form-input" placeholder="Postal code" value={postal} onChange={e=>setPostal(e.target.value)} />
            </div>
            <label className="text text-small" style={{ display:'flex', alignItems:'center', gap:6 }}>
              <input type="checkbox" checked={isHQ} onChange={e=>setIsHQ(e.target.checked)} /> Headquarters
            </label>
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

export default AddLocationModal;


