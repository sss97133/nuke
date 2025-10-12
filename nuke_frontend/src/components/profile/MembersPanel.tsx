import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface MembersPanelProps {
  shopId: string;
  allowInvite?: boolean;
}

interface MemberRow {
  id: string;
  user_id: string;
  role: 'owner'|'admin'|'staff'|'contractor';
  status: 'active'|'invited'|'inactive'|'removed';
  created_at: string;
}

interface InviteRow {
  id: string;
  email: string;
  role: 'owner'|'admin'|'staff'|'contractor';
  status: 'pending'|'accepted'|'revoked'|'expired';
  created_at: string;
  token: string;
}

const MembersPanel: React.FC<MembersPanelProps> = ({ shopId, allowInvite = true }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'owner'|'admin'|'staff'|'contractor'>('staff');
  const [inviting, setInviting] = useState(false);
  const [responsibilities, setResponsibilities] = useState<Record<string, { id: string; responsibility: string }[]>>({});
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<{ id: string; email: string | null; full_name?: string | null }[]>([]);

  const loadAll = async () => {
    if (!shopId) return;
    try {
      setLoading(true);
      setError(null);
      const [memRes, invRes, deptRes, respRes] = await Promise.all([
        supabase.from('shop_members').select('id, user_id, role, status, created_at').eq('shop_id', shopId).order('created_at', { ascending: false }),
        supabase.from('shop_invitations').select('id, email, role, status, created_at, token').eq('shop_id', shopId).order('created_at', { ascending: false }),
        supabase.from('shop_departments').select('id, name').eq('shop_id', shopId).order('name', { ascending: true }),
        supabase.from('shop_member_responsibilities').select('id, member_id, responsibility').eq('shop_id', shopId)
      ]);
      if (memRes.error) throw memRes.error;
      if (invRes.error) throw invRes.error;
      if (deptRes.error) throw deptRes.error;
      if (respRes.error) throw respRes.error;
      setMembers((memRes.data as MemberRow[]) || []);
      setInvites((invRes.data as InviteRow[]) || []);
      setDepartments((deptRes.data as any[]) || []);
      const respByMember: Record<string, { id: string; responsibility: string }[]> = {};
      ((respRes.data as any[]) || []).forEach((r: any) => {
        if (!respByMember[r.member_id]) respByMember[r.member_id] = [];
        respByMember[r.member_id].push({ id: r.id, responsibility: r.responsibility });
      });
      setResponsibilities(respByMember);
    } catch (e: any) {
      setError(e?.message || 'Failed to load team');
      setMembers([]);
      setInvites([]);
      setDepartments([]);
      setResponsibilities({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [shopId]);

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    try {
      setInviting(true);
      const token = (crypto as any)?.randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2);
      const { data: auth } = await supabase.auth.getUser();
      const inviterId = auth.user?.id;
      if (!inviterId) throw new Error('Not authenticated');
      const { error } = await supabase.from('shop_invitations').insert({
        shop_id: shopId,
        email: inviteEmail.trim(),
        role: inviteRole,
        invited_by: inviterId,
        token,
        status: 'pending'
      } as any);
      if (error) throw error;

      // If the invitee already has an account, create an in-app notification with deep link
      const { data: invitee } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', inviteEmail.trim())
        .single();
      if (invitee?.id) {
        const link = `${window.location.origin}/invite/${token}`;
        await supabase.from('user_notifications').insert({
          user_id: invitee.id,
          type: 'shop_invite',
          title: 'You have been invited to join an organization',
          message: 'Open to accept or decline the invitation.',
          metadata: { shop_id: shopId, role: inviteRole, token, link_url: link }
        } as any);

        // Create a message thread between inviter and invitee with the link
        const { data: thread, error: tErr } = await supabase
          .from('message_threads')
          .insert({ subject: 'Organization Invitation', created_by: inviterId } as any)
          .select('id')
          .single();
        if (!tErr && thread?.id) {
          await supabase.from('thread_participants').insert([
            { thread_id: thread.id, user_id: inviterId } as any,
            { thread_id: thread.id, user_id: invitee.id } as any,
          ]);
          await supabase.from('messages').insert({
            thread_id: thread.id,
            sender_id: inviterId,
            body: `You are invited to join an organization. Accept here: ${link}`
          } as any);
        }
      }

      // Try sending email via Edge Function (best-effort)
      try {
        const { data: shop } = await supabase.from('shops').select('name').eq('id', shopId).single();
        const link = `${window.location.origin}/invite/${token}`;
        const { error: sendErr } = await (supabase as any).functions.invoke('send-invite-email', {
          body: { to: inviteEmail.trim(), link, orgName: (shop as any)?.name, role: inviteRole }
        });
        if (sendErr) throw sendErr;
      } catch (e: any) {
        console.warn('Email invite failed, use mailto fallback', e);
        alert('Email delivery not configured. Use the Email invite button to send manually.');
      }
      setInviteEmail('');
      await loadAll();
    } catch (e: any) {
      alert(`Invite failed: ${e?.message || e}`);
    } finally {
      setInviting(false);
    }
  };

  const revokeInvite = async (id: string) => {
    try {
      const { error } = await supabase.from('shop_invitations').update({ status: 'revoked' }).eq('id', id);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      alert(`Revoke failed: ${e?.message || e}`);
    }
  };

  const updateMember = async (id: string, updates: Partial<{ role: MemberRow['role']; department_id: string | null }>) => {
    try {
      const { error } = await supabase.from('shop_members').update(updates as any).eq('id', id);
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      alert(`Update failed: ${e?.message || e}`);
    }
  };

  const addResponsibility = async (memberId: string) => {
    try {
      const text = prompt('Add responsibility (e.g., Titles, Sales, Accounting)');
      if (!text) return;
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      const { error } = await supabase.from('shop_member_responsibilities').insert({
        shop_id: shopId,
        member_id: memberId,
        responsibility: text,
        created_by: userId || null
      } as any).select('id').single();
      if (error) throw error;
      await loadAll();
    } catch (e: any) {
      alert(`Add responsibility failed: ${e?.message || e}`);
    }
  };

  const searchUsers = async () => {
    try {
      setError(null);
      const q = userQuery.trim();
      if (!q) { setUserResults([]); return; }
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
        .limit(20);
      if (error) throw error;
      setUserResults((data as any[]) || []);
    } catch (e: any) {
      setUserResults([]);
      alert(`Search failed: ${e?.message || e}`);
    }
  };

  const addMemberDirect = async (userId: string) => {
    try {
      const { error } = await supabase.from('shop_members').upsert({
        shop_id: shopId,
        user_id: userId,
        role: 'staff',
        status: 'active'
      } as any, { onConflict: 'shop_id,user_id' } as any);
      if (error) throw error;
      setUserResults([]);
      setUserQuery('');
      await loadAll();
    } catch (e: any) {
      alert(`Add member failed: ${e?.message || e}`);
    }
  };

  return (
    <div className="space-y-2">
      {loading && <div className="text text-small text-muted">Loading team…</div>}
      {error && <div className="text text-small" style={{ color: '#b91c1c' }}>{error}</div>}

      {!loading && !error && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          {/* Members list */}
          <div>
            <div className="text text-small text-muted" style={{ marginBottom:6 }}>Members</div>
            {members.length === 0 ? (
              <div className="text text-small text-muted">No members yet.</div>
            ) : (
              <div className="space-y-2">
                {members.map(m => (
                  <div key={m.id} className="card">
                    <div className="card-body" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <div className="text text-small" style={{ minWidth: 200 }}>{m.user_id}</div>
                      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                        <select className="form-input" value={m.role} onChange={e=>updateMember(m.id, { role: e.target.value as any })}>
                          <option value="owner">owner</option>
                          <option value="admin">admin</option>
                          <option value="staff">staff</option>
                          <option value="contractor">contractor</option>
                        </select>
                        <select className="form-input" onChange={e=>updateMember(m.id, { department_id: e.target.value || null })}>
                          <option value="">No department</option>
                          {departments.map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                        <span className="text text-small text-muted">{m.status}</span>
                        <button className="button button-small" onClick={()=>addResponsibility(m.id)}>Add responsibility</button>
                      </div>
                    </div>
                    {responsibilities[m.id]?.length > 0 && (
                      <div className="card-body" style={{ paddingTop: 0 }}>
                        <div className="text text-small text-muted" style={{ marginBottom: 4 }}>Responsibilities:</div>
                        <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                          {responsibilities[m.id].map(r => (
                            <span key={r.id} className="badge" style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                              {r.responsibility}
                              <button className="button button-small" title="Edit" onClick={async ()=>{
                                const text = prompt('Edit responsibility', r.responsibility);
                                if (!text || text === r.responsibility) return;
                                try { await supabase.from('shop_member_responsibilities').update({ responsibility: text } as any).eq('id', r.id); await loadAll(); } catch (e: any) { alert(e?.message || e); }
                              }}>✎</button>
                              <button className="button button-small button-secondary" title="Remove" onClick={async ()=>{
                                try { await supabase.from('shop_member_responsibilities').delete().eq('id', r.id); await loadAll(); } catch (e: any) { alert(e?.message || e); }
                              }}>×</button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Invitations */}
          <div>
            <div className="text text-small text-muted" style={{ marginBottom:6 }}>Invitations</div>
            {allowInvite && (
              <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
                <input className="form-input" placeholder="email@example.com" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} />
                <select className="form-input" value={inviteRole} onChange={e=>setInviteRole(e.target.value as any)}>
                  <option value="owner">owner</option>
                  <option value="admin">admin</option>
                  <option value="staff">staff</option>
                  <option value="contractor">contractor</option>
                </select>
                <button className="button button-small" onClick={sendInvite} disabled={inviting || !inviteEmail.trim()}>{inviting ? 'Sending…' : 'Send Invite'}</button>
              </div>
            )}

            {/* Direct Add - User Search */}
            <div className="text text-small text-muted" style={{ marginBottom:6, marginTop:8 }}>Find users by email/name</div>
            <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
              <input className="form-input" placeholder="Search users" value={userQuery} onChange={e=>setUserQuery(e.target.value)} />
              <button className="button button-small" onClick={searchUsers}>Search</button>
            </div>
            {userResults.length > 0 && (
              <div className="space-y-1" style={{ marginBottom: 8 }}>
                {userResults.map(u => (
                  <div key={u.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div className="text text-small">{u.full_name || u.email || u.id}</div>
                    <button className="button button-small" onClick={()=>addMemberDirect(u.id)}>Add as member</button>
                  </div>
                ))}
              </div>
            )}

            {invites.length === 0 ? (
              <div className="text text-small text-muted">No invitations.</div>
            ) : (
              <div className="space-y-2">
                {invites.map(inv => (
                  <div key={inv.id} className="card">
                    <div className="card-body" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div className="text text-small">{inv.email} — {inv.role} ({inv.status})</div>
                      {inv.status === 'pending' && (
                        <div style={{ display:'flex', gap:6 }}>
                          <button className="button button-small" onClick={()=>{
                            const link = `${window.location.origin}/invite/${inv.token}`;
                            navigator.clipboard.writeText(link).then(() => alert('Invite link copied')).catch(()=>alert(link));
                          }}>Copy link</button>
                          <a
                            className="button button-small"
                            href={`mailto:${inv.email}?subject=Invitation to join our organization&body=${encodeURIComponent(
                              `Please accept your invite here: ${window.location.origin}/invite/${inv.token}\n\nIf you don't have an account yet, sign up and you'll be brought back to accept: ${window.location.origin}/login?redirect=/invite/${inv.token}`
                            )}`}
                          >Email invite</a>
                          <button className="button button-small button-secondary" onClick={()=>revokeInvite(inv.id)}>Revoke</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MembersPanel;
