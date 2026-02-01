import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface AddLicenseModalProps {
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

const LICENSE_TYPES = [
  'dealer_license','garage_license','repair_facility_license','body_shop_license','salvage_dealer_license','smog_check_license','wholesale_license','auction_license','transport_license','tow_license','rental_license','other'
] as const;

const AddLicenseModal: React.FC<AddLicenseModalProps> = ({ shopId, isOpen, onClose }) => {
  const [licenseType, setLicenseType] = useState<typeof LICENSE_TYPES[number]>('dealer_license');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [issuingState, setIssuingState] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
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
    if (!licenseNumber.trim()) return;
    try {
      setLoading(true);
      const payload: any = {
        shop_id: shopId,
        license_type: licenseType,
        license_number: licenseNumber.trim(),
        issuing_state: issuingState || null,
        expiration_date: expirationDate || null,
        location_id: locationId || null
      };
      const { error } = await supabase.from('shop_licenses').insert(payload);
      if (error) throw error;
      onClose(true);
    } catch (e: any) {
      alert(`Add license failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={modalStyle} onClick={() => onClose()}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>Add License</div>
        <div style={bodyStyle}>
          <div style={{ display:'grid', gap:6 }}>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <select className="form-input" value={licenseType} onChange={e=>setLicenseType(e.target.value as any)}>
                {LICENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input className="form-input" placeholder="License number" value={licenseNumber} onChange={e=>setLicenseNumber(e.target.value)} />
            </div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <input className="form-input" placeholder="Issuing state (e.g., NV)" value={issuingState} onChange={e=>setIssuingState(e.target.value)} />
              <input className="form-input" type="date" value={expirationDate} onChange={e=>setExpirationDate(e.target.value)} />
            </div>
            <select className="form-input" value={locationId} onChange={e=>setLocationId(e.target.value)}>
              <option value="">No location</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:6, marginTop:8 }}>
            <button className="button button-small button-secondary" onClick={()=>onClose()} disabled={loading}>Cancel</button>
            <button className="button button-small" onClick={submit} disabled={loading || !licenseNumber.trim()}>{loading ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddLicenseModal;


