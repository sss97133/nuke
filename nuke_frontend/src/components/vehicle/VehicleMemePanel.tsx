import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { StreamActionsService, type StreamAction, type StreamActionPack } from '../../services/streamActionsService';
import { CashBalanceService } from '../../services/cashBalanceService';

export default function VehicleMemePanel({
  vehicleId,
  disabled,
}: {
  vehicleId: string;
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
  const [cashCents, setCashCents] = useState<number | null>(null);

  const targetKey = `vehicle:${vehicleId}`;

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
          setCashCents(null);
          return;
        }

        try {
          const balance = await CashBalanceService.getUserBalance(user.id);
          if (!mounted) return;
          setCashCents(balance?.available_cents ?? 0);
        } catch {
          if (!mounted) return;
          setCashCents(null);
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
        console.error('Vehicle meme load error:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [user?.id, vehicleId]);

  const refreshPurchases = async () => {
    if (!user?.id) return;
    const purchases = await StreamActionsService.listMyPurchases(user.id);
    setMyPackIds(new Set(purchases.map((x) => x.pack_id)));
    try {
      const balance = await CashBalanceService.getUserBalance(user.id);
      setCashCents(balance?.available_cents ?? 0);
    } catch {
      // ignore
    }
  };

  const purchasePack = async (packId: string) => {
    if (!user?.id) {
      showToast('Login required', 'warning');
      return;
    }
    try {
      setBuyingPackId(packId);
      await StreamActionsService.purchasePack(packId);
      await refreshPurchases();
      showToast('Pack purchased', 'success');
    } catch (e: any) {
      console.error('Purchase pack error:', e);
      showToast(e?.message || 'Purchase failed', 'error');
    } finally {
      setBuyingPackId(null);
    }
  };

  const sendMeme = async (actionId: string) => {
    if (!user?.id) {
      showToast('Login required', 'warning');
      return;
    }
    try {
      setSendingActionId(actionId);
      await StreamActionsService.sendContentAction(targetKey, actionId);
      await refreshPurchases();
    } catch (e: any) {
      const msg = String(e?.message || 'Send failed');
      if (/cooldown/i.test(msg)) {
        showToast('Cooldown active', 'warning');
      } else if (/Insufficient/i.test(msg)) {
        showToast('Insufficient balance', 'error');
      } else {
        showToast(msg, 'error');
      }
    } finally {
      setSendingActionId(null);
    }
  };

  const canInteract = !!user?.id && !disabled;
  const hasAnyOwned = myPackIds.size > 0;

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>MEME DROPS</div>
        <div style={{ fontSize: '8pt', color: '#6b7280' }}>
          Cost per drop: $0.01
          {typeof cashCents === 'number' ? ` · Balance: $${(cashCents / 100).toFixed(2)}` : ''}
        </div>
      </div>
      <div className="card-body" style={{ fontSize: '8pt' }}>
        {!user?.id && (
          <div style={{ color: '#757575' }}>
            Login to purchase packs and drop memes on this vehicle.
          </div>
        )}

        {loading && <div style={{ color: '#757575' }}>Loading…</div>}

        {user?.id && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {packs.map((p) => {
                const owned = myPackIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => (owned ? null : purchasePack(p.id))}
                    disabled={!canInteract || owned || buyingPackId === p.id}
                    className="button button-secondary"
                    style={{
                      fontSize: '8pt',
                      padding: '6px 10px',
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
                    onClick={() => sendMeme(a.id)}
                    disabled={!canInteract || sendingActionId === a.id}
                    className="button button-primary"
                    style={{ fontSize: '8pt', padding: '6px 10px', opacity: !canInteract ? 0.6 : 1 }}
                    title={a.render_text || a.title}
                  >
                    {sendingActionId === a.id ? 'SENDING…' : a.title.toUpperCase()}
                  </button>
                ))}
                {ownedActions.length === 0 && (
                  <div style={{ color: '#757575' }}>No actions available.</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


