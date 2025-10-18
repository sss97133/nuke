import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
// AppLayout now provided globally by App.tsx
import '../design-system.css';

const AcceptInvite: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string>('');
  const [working, setWorking] = useState<boolean>(false);
  const [invite, setInvite] = useState<{ id: string; shop_id: string; role: string; status: string; department_id?: string | null } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!token) { setMessage('Missing invitation token.'); return; }

        const { data: auth } = await supabase.auth.getUser();
        const userId = auth.user?.id;
        if (!userId) {
          // Not authenticated: send to login, then redirect back here
          const redirect = encodeURIComponent(window.location.pathname);
          window.location.href = `/login?redirect=${redirect}`;
          return;
        }

        // Load invitation
        const { data: inv, error: invErr } = await supabase
          .from('shop_invitations')
          .select('id, shop_id, role, status, department_id')
          .eq('token', token)
          .single();
        if (invErr || !inv) { setMessage('Invitation not found.'); return; }
        if (inv.status !== 'pending') {
          setMessage(`Invitation is already ${inv.status}.`);
          if (inv.status === 'accepted') setTimeout(() => navigate(`/org/${inv.shop_id}?tab=members`), 1000);
          return;
        }
        setInvite(inv as any);
      } catch (e: any) {
        setMessage(e?.message || 'Failed to accept invitation');
      }
    })();
  }, [token, navigate]);

  const accept = async () => {
    if (!invite || !token) return;
    try {
      setWorking(true);
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) return;
      const { error: addErr } = await supabase.from('shop_members').upsert({ shop_id: invite.shop_id, user_id: userId, role: invite.role, status: 'active', department_id: invite.department_id || null } as any, { onConflict: 'shop_id,user_id' } as any);
      if (addErr) { setMessage(`Failed to add membership: ${addErr.message}`); setWorking(false); return; }
      await supabase.from('shop_invitations').update({ status: 'accepted' }).eq('id', invite.id);
      await supabase.from('user_notifications').update({ is_read: true } as any).contains('metadata', { token });
      try {
        const { data: inviter } = await supabase.from('shop_invitations').select('invited_by').eq('id', invite.id).single();
        if (inviter?.invited_by) {
          const { data: thread } = await supabase.from('message_threads').insert({ subject: 'Invitation accepted', created_by: userId } as any).select('id').single();
          if (thread?.id) {
            await supabase.from('thread_participants').insert([{ thread_id: thread.id, user_id: userId } as any, { thread_id: thread.id, user_id: inviter.invited_by } as any]);
            await supabase.from('messages').insert({ thread_id: thread.id, sender_id: userId, body: 'I have accepted the organization invitation.' } as any);
          }
        }
      } catch {}
      try { window.localStorage.setItem('primaryShopId', invite.shop_id); } catch {}
      setMessage('Invitation accepted. Redirecting…');
      setWorking(false);
      setTimeout(() => navigate(`/org/${invite.shop_id}?tab=members`), 800);
    } catch (e: any) {
      setMessage(e?.message || 'Failed to accept invitation');
      setWorking(false);
    }
  };

  const decline = async () => {
    if (!invite || !token) return;
    try {
      const reason = window.prompt('Optional reason for declining?');
      setWorking(true);
      await supabase.from('shop_invitations').update({ status: 'declined' } as any).eq('id', invite.id);
      await supabase.from('user_notifications').update({ is_read: true } as any).contains('metadata', { token });
      try {
        const { data: inviter } = await supabase.from('shop_invitations').select('invited_by').eq('id', invite.id).single();
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth.user?.id;
        if (inviter?.invited_by && userId) {
          const { data: thread } = await supabase.from('message_threads').insert({ subject: 'Invitation declined', created_by: userId } as any).select('id').single();
          if (thread?.id) {
            await supabase.from('thread_participants').insert([{ thread_id: thread.id, user_id: userId } as any, { thread_id: thread.id, user_id: inviter.invited_by } as any]);
            await supabase.from('messages').insert({ thread_id: thread.id, sender_id: userId, body: `I declined the invitation.${reason ? ` Reason: ${reason}` : ''}` } as any);
          }
        }
      } catch {}
      setMessage('Invitation declined.');
      setWorking(false);
    } catch (e: any) {
      setMessage(e?.message || 'Failed to decline invitation');
      setWorking(false);
    }
  };

  return (
    
      <div className="container compact">
        <div className="main">
          <div className="card"><div className="card-body">
            {invite ? (
              <div className="space-y-2">
                <div className="text">You have an organization invitation.</div>
                <div style={{ display:'flex', gap:6 }}>
                  <button className="button" onClick={accept} disabled={working}>{working ? 'Working…' : 'Accept'}</button>
                  <button className="button button-secondary" onClick={decline} disabled={working}>Decline</button>
                </div>
              </div>
            ) : (
              <>
                <div className="text">{message || 'Loading…'}</div>
                {working && <div className="text text-small text-muted" style={{ marginTop: 6 }}>Please wait…</div>}
              </>
            )}
          </div></div>
        </div>
      </div>
    
  );
};

export default AcceptInvite;


