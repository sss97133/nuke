import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { StreamActionsService, type StreamAction, type StreamActionPack } from '../../services/streamActionsService';

export default function StreamActionPanel({
  streamId,
  disabled,
}: {
  streamId: string;
  disabled?: boolean;
}) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [packs, setPacks] = useState<StreamActionPack[]>([]);
  const [myPackIds, setMyPackIds] = useState<Set<string>>(new Set());
  const [actions, setActions] = useState<StreamAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [buyingPackId, setBuyingPackId] = useState<string | null>(null);
  const [sendingActionId, setSendingActionId] = useState<string | null>(null);

  const ownedActions = useMemo(() => {
    if (!myPackIds.size) return [];
    return actions.filter((a) => myPackIds.has(a.pack_id));
  }, [actions, myPackIds]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        setLoading(true);
        const p = await StreamActionsService.listPacks();
        if (!mounted) return;
        setPacks(p);

        if (!user?.id) {
          setMyPackIds(new Set());
          setActions([]);
          return;
        }

        const purchases = await StreamActionsService.listMyPurchases(user.id);
        if (!mounted) return;
        const ids = new Set(purchases.map((x) => x.pack_id));
        setMyPackIds(ids);

        const act = await StreamActionsService.listActionsForPacks(p.map((x) => x.id));
        if (!mounted) return;
        setActions(act);
      } catch (e: any) {
        if (!mounted) return;
        console.error('Stream actions load error:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const purchasePack = async (packId: string) => {
    if (!user?.id) {
      showToast('Login required', 'warning');
      return;
    }
    try {
      setBuyingPackId(packId);
      await StreamActionsService.purchasePack(packId);
      const purchases = await StreamActionsService.listMyPurchases(user.id);
      setMyPackIds(new Set(purchases.map((x) => x.pack_id)));
      showToast('Pack purchased', 'success');
    } catch (e: any) {
      console.error('Purchase pack error:', e);
      showToast(e?.message || 'Purchase failed', 'error');
    } finally {
      setBuyingPackId(null);
    }
  };

  const sendAction = async (actionId: string) => {
    if (!user?.id) {
      showToast('Login required', 'warning');
      return;
    }
    try {
      setSendingActionId(actionId);
      await StreamActionsService.sendAction(streamId, actionId);
    } catch (e: any) {
      const msg = String(e?.message || 'Send failed');
      // Cooldown is intentionally strict; avoid loud errors.
      if (/cooldown/i.test(msg)) {
        showToast('Cooldown active', 'warning');
      } else if (/Pack not owned/i.test(msg)) {
        showToast('Pack not owned', 'error');
      } else {
        showToast(msg, 'error');
      }
    } finally {
      setSendingActionId(null);
    }
  };

  const hasAnyOwned = myPackIds.size > 0;
  const canInteract = !!user?.id && !disabled;

  return (
    <div style={{ borderTop: '1px solid #bdbdbd' }}>
      <div
        style={{
          background: '#e0e0e0',
          padding: '8px',
          borderBottom: '1px solid #bdbdbd',
          fontSize: '8pt',
          fontWeight: 'bold',
        }}
      >
        STREAM ACTIONS
      </div>

      <div style={{ padding: '8px', fontSize: '8pt' }}>
        {!user?.id && (
          <div style={{ color: '#757575' }}>
            Login to purchase packs and trigger overlays.
          </div>
        )}

        {loading && <div style={{ color: '#757575' }}>Loading actions...</div>}

        {user?.id && !loading && !hasAnyOwned && (
          <div style={{ marginBottom: '8px', color: '#424242' }}>
            Purchase a pack to unlock popups and sound effects.
          </div>
        )}

        {user?.id && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {packs.map((p) => {
                const owned = myPackIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => (owned ? null : purchasePack(p.id))}
                    disabled={!canInteract || owned || buyingPackId === p.id}
                    style={{
                      padding: '6px 8px',
                      fontSize: '8pt',
                      border: '1px solid #bdbdbd',
                      background: owned ? '#d1fae5' : '#f5f5f5',
                      color: '#111827',
                      borderRadius: '0px',
                      cursor: owned ? 'default' : 'pointer',
                      opacity: !canInteract ? 0.6 : 1,
                    }}
                    title={p.description || p.name}
                  >
                    {owned ? `OWNED: ${p.name}` : `BUY: ${p.name} ($${(p.price_cents / 100).toFixed(2)})`}
                  </button>
                );
              })}
            </div>

            {hasAnyOwned && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {ownedActions.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => sendAction(a.id)}
                    disabled={!canInteract || sendingActionId === a.id}
                    style={{
                      padding: '6px 8px',
                      fontSize: '8pt',
                      border: '1px solid #bdbdbd',
                      background: '#424242',
                      color: 'white',
                      borderRadius: '0px',
                      cursor: 'pointer',
                      opacity: !canInteract ? 0.6 : 1,
                    }}
                    title={a.render_text || a.title}
                  >
                    {sendingActionId === a.id ? 'SENDING...' : a.title.toUpperCase()}
                  </button>
                ))}

                {ownedActions.length === 0 && (
                  <div style={{ color: '#757575' }}>
                    No actions available.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


