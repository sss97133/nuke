import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface InviteMemberModalProps {
  shopId: string;
  isOpen: boolean;
  onClose: () => void;
}

const modalStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
};
const panelStyle: React.CSSProperties = {
  width: '520px', maxWidth: '95%', background: 'var(--surface)', border: '1px solid #c0c0c0', borderRadius: 2
};
const headerStyle: React.CSSProperties = { padding: 6, borderBottom: '1px solid #c0c0c0', background: 'var(--bg)', fontWeight: 700 };
const bodyStyle: React.CSSProperties = { padding: 8 };

const InviteMemberModal: React.FC<InviteMemberModalProps> = ({ shopId, isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner'|'admin'|'staff'|'contractor'>('staff');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('shop_departments')
          .select('id, name')
          .eq('shop_id', shopId)
          .order('name', { ascending: true });
        if (error) throw error;
        setDepartments((data as any[]) || []);
      } catch {
        setDepartments([]);
      }
    })();
  }, [shopId, isOpen]);

  if (!isOpen) return null;

  const submit = async () => {
    const normalized = email.trim();
    if (!normalized) return;
    try {
      setLoading(true);
      const { data: authData } = await supabase.auth.getUser();
      const inviterId = authData?.user?.id;
      if (!inviterId) throw new Error('Not authenticated');
      const token = (crypto as any)?.randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2);
      const { error } = await supabase.from('shop_invitations').insert({
        shop_id: shopId,
        email: normalized,
        role,
        invited_by: inviterId,
        department_id: departmentId || null,
        token,
        status: 'pending'
      } as any);
      if (error) throw error;
      // Best-effort: notify existing users in-app
      try {
        const { data: invitee } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', normalized)
          .single();
        if (invitee?.id) {
          const link = `${window.location.origin}/invite/${token}`;
          await supabase.from('user_notifications').insert({
            user_id: invitee.id,
            type: 'shop_invite',
            title: 'You have been invited to join an organization',
            message: 'Open to accept or decline the invitation.',
            metadata: { shop_id: shopId, role, token, link_url: link }
          } as any);
        }
      } catch {}

      // Best-effort: send invite email via Edge Function
      try {
        const { data: shop } = await supabase.from('shops').select('name').eq('id', shopId).single();
        const link = `${window.location.origin}/invite/${token}`;
        const { error: sendErr } = await (supabase as any).functions.invoke('send-invite-email', {
          body: { to: normalized, link, orgName: (shop as any)?.name, role }
        });
        if (sendErr) throw sendErr;
      } catch {
        // Ignore email failures; caller can use manual email
      }
      // Department can be applied after acceptance; no placeholder member is created here
      onClose();
    } catch (e: any) {
      alert(`Invite failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={modalStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>Invite Member</div>
        <div style={bodyStyle}>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <input className="form-input" placeholder="email@example.com" value={email} onChange={e=>setEmail(e.target.value)} />
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <select className="form-input" value={role} onChange={e=>setRole(e.target.value as any)}>
                <option value="owner">owner</option>
                <option value="admin">admin</option>
                <option value="staff">staff</option>
                <option value="contractor">contractor</option>
              </select>
              <select className="form-input" value={departmentId} onChange={e=>setDepartmentId(e.target.value)}>
                <option value="">No department</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:6, marginTop:8 }}>
            <button className="button button-small button-secondary" onClick={onClose} disabled={loading}>Cancel</button>
            <button className="button button-small" onClick={submit} disabled={loading || !email.trim()}>{loading ? 'Sending…' : 'Send Invite'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InviteMemberModal;


