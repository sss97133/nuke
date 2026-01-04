import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { StreamActionsService, type StreamAction, type StreamActionPack } from '../../services/streamActionsService';
import { CashBalanceService } from '../../services/cashBalanceService';

type ActionPreview = {
  action: StreamAction;
  pack: StreamActionPack | null;
};

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
  const [selectedPackId, setSelectedPackId] = useState<string>('');
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const holdTimerRef = useRef<number | null>(null);

  const targetKey = `vehicle:${vehicleId}`;

  const ownedActions = useMemo(() => {
    if (!myPackIds.size) return [];
    return actions.filter((a) => myPackIds.has(a.pack_id));
  }, [actions, myPackIds]);

  const selectedPack = useMemo(() => {
    if (!selectedPackId) return null;
    return packs.find((p) => p.id === selectedPackId) || null;
  }, [packs, selectedPackId]);

  const selectedPackOwned = useMemo(() => {
    if (!selectedPackId) return false;
    return myPackIds.has(selectedPackId);
  }, [myPackIds, selectedPackId]);

  const selectedPackActions = useMemo(() => {
    if (!selectedPackId) return [];
    return actions.filter((a) => a.pack_id === selectedPackId);
  }, [actions, selectedPackId]);

  const sortedPacks = useMemo(() => {
    const owned: StreamActionPack[] = [];
    const unowned: StreamActionPack[] = [];
    for (const p of packs) {
      if (myPackIds.has(p.id)) owned.push(p);
      else unowned.push(p);
    }
    const byName = (a: StreamActionPack, b: StreamActionPack) => a.name.localeCompare(b.name);
    owned.sort(byName);
    unowned.sort(byName);
    return [...owned, ...unowned];
  }, [packs, myPackIds]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        setLoading(true);
        const p = await StreamActionsService.listPacks();
        if (!mounted) return;
        setPacks(p);

        // Free packs (price_cents = 0) are automatically "owned" by everyone
        const freePackIds = new Set(p.filter((pack) => pack.price_cents === 0).map((pack) => pack.id));

        if (!user?.id) {
          setMyPackIds(freePackIds);
          // Still load actions for free packs even if not logged in
          const act = await StreamActionsService.listActionsForPacks(Array.from(freePackIds));
          if (!mounted) return;
          setActions(act);
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
        const purchasedIds = new Set(purchases.map((x) => x.pack_id));
        // Combine free packs with purchased packs
        const allOwnedIds = new Set([...freePackIds, ...purchasedIds]);
        setMyPackIds(allOwnedIds);

        const act = await StreamActionsService.listActionsForPacks(p.map((x) => x.id));
        if (!mounted) return;
        setActions(act);
      } catch (e: any) {
        if (!mounted) return;
        console.error('Vehicle meme load error:', e);
        // Show error to user
        if (e?.message) {
          console.error('Error details:', e.message);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [user?.id, vehicleId]);

  useEffect(() => {
    // Choose a sensible default pack/action once data arrives.
    if (!packs.length) return;

    setSelectedPackId((prev) => {
      if (prev && packs.some((p) => p.id === prev)) return prev;
      const owned = packs.find((p) => myPackIds.has(p.id));
      return owned?.id || packs[0].id;
    });
  }, [packs, myPackIds]);

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
  const hasAnyPacks = packs.length > 0;

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const openPreview = (action: StreamAction) => {
    const pack = packs.find((p) => p.id === action.pack_id) || null;
    setPreview({ action, pack });
  };

  const onActionPointerDown = (action: StreamAction) => {
    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      openPreview(action);
    }, 350);
  };

  const onActionPointerUp = (action: StreamAction) => {
    // If we haven't opened the preview yet, treat this as a normal click-send.
    if (holdTimerRef.current) {
      clearHoldTimer();
      void sendMeme(action.id);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>Meme Library</div>
        <div style={{ fontSize: '8pt', color: '#6b7280', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span>Curated packs</span>
          {typeof cashCents === 'number' ? <span>Balance: ${(cashCents / 100).toFixed(2)}</span> : null}
        </div>
      </div>
      <div className="card-body" style={{ fontSize: '9pt' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ color: '#6b7280', fontSize: '8pt' }}>
            Keyboard mode: click to drop. Press-and-hold (or long-press on mobile) to preview and expand.
          </div>

          {!user?.id ? (
            <div style={{ color: '#757575' }}>Login to use the Meme Library.</div>
          ) : null}

          {loading ? <div style={{ color: '#757575' }}>Loading...</div> : null}

          {!loading && !hasAnyPacks ? (
            <div style={{ color: '#757575' }}>
              No packs available. If you're an admin, you can add packs at <a href="/admin/meme-library" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>/admin/meme-library</a>.
            </div>
          ) : null}

          {!loading && actions.length > 0 ? (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: 12,
              marginTop: hasAnyPacks ? 0 : 12 
            }}>
              <div style={{ 
                fontSize: '9pt', 
                fontWeight: 700, 
                color: '#374151',
                borderBottom: '1px solid var(--border)',
                paddingBottom: '6px'
              }}>
                Meme Library Index ({actions.length} memes)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))',
                  gap: 8,
                  maxHeight: '400px',
                  overflowY: 'auto',
                  padding: '8px',
                  background: 'var(--bg)',
                  borderRadius: '4px',
                  border: '1px solid var(--border)'
                }}
              >
                {actions.map((a) => {
                  const pack = packs.find((p) => p.id === a.pack_id);
                  const isOwned = pack ? myPackIds.has(pack.id) : false;
                  const isSending = sendingActionId === a.id;
                  const hasImage = !!a.image_url;
                  return (
                    <button
                      key={a.id}
                      className="button button-secondary"
                      style={{
                        fontSize: '8pt',
                        padding: hasImage ? '6px' : '10px 8px',
                        minHeight: 44,
                        whiteSpace: 'normal',
                        lineHeight: 1.1,
                        opacity: !isOwned ? 0.5 : 1,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        position: 'relative',
                        cursor: isOwned ? 'pointer' : 'not-allowed',
                      }}
                      disabled={!canInteract || !isOwned || isSending}
                      title={`${a.title}${pack ? ` (${pack.name})` : ''}${!isOwned ? ' - Locked' : ''}`}
                      onPointerDown={() => isOwned && onActionPointerDown(a)}
                      onPointerUp={() => isOwned && onActionPointerUp(a)}
                      onPointerCancel={() => clearHoldTimer()}
                      onPointerLeave={() => clearHoldTimer()}
                    >
                      {!isOwned && (
                        <div style={{
                          position: 'absolute',
                          top: '2px',
                          right: '2px',
                          fontSize: '7pt',
                          background: 'rgba(0,0,0,0.7)',
                          color: 'white',
                          padding: '2px 4px',
                          borderRadius: '2px'
                        }}>
                          🔒
                        </div>
                      )}
                      {hasImage && a.image_url ? (
                        <img
                          src={a.image_url}
                          alt={a.title}
                          style={{
                            width: '100%',
                            height: 54,
                            objectFit: 'cover',
                            border: '1px solid rgba(255,255,255,0.12)',
                            opacity: isOwned ? 1 : 0.6,
                            display: 'block',
                          }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : null}
                      <div style={{ width: '100%', textAlign: 'left' }}>
                        {isSending ? 'SENDING...' : a.title}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!loading && hasAnyPacks ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <div style={{ fontSize: '8pt', color: '#6b7280', marginRight: 4 }}>Packs</div>
              {sortedPacks.map((p) => {
                const owned = myPackIds.has(p.id);
                const active = p.id === selectedPackId;
                return (
                  <button
                    key={p.id}
                    className="button button-secondary"
                    onClick={() => setSelectedPackId(p.id)}
                    style={{
                      fontSize: '8pt',
                      padding: '6px 10px',
                      borderColor: active ? 'var(--primary)' : undefined,
                      opacity: !canInteract && !active ? 0.7 : 1,
                    }}
                    title={p.description || p.name}
                  >
                    {owned ? p.name : `${p.name} ($${(p.price_cents / 100).toFixed(2)})`}
                  </button>
                );
              })}

              <div style={{ flex: 1 }} />

              <button
                className="button button-secondary"
                disabled={!canInteract || !selectedPackId || selectedPackOwned || buyingPackId === selectedPackId}
                onClick={() => purchasePack(selectedPackId)}
                style={{ fontSize: '8pt', padding: '6px 10px', opacity: !canInteract ? 0.6 : 1 }}
                title={selectedPack?.description || selectedPack?.name || ''}
              >
                {buyingPackId === selectedPackId ? 'BUYING...' : selectedPackOwned ? 'OWNED' : 'BUY PACK'}
              </button>
            </div>
          ) : null}

          {!loading && user?.id && hasAnyPacks && selectedPackId ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!selectedPackOwned ? (
                <div style={{ color: '#757575', fontSize: '8pt' }}>
                  This pack is locked. Buy it to unlock the keyboard.
                </div>
              ) : null}

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))',
                  gap: 8,
                  opacity: selectedPackOwned ? 1 : 0.55,
                  pointerEvents: selectedPackOwned ? 'auto' : 'none',
                  userSelect: 'none',
                }}
                aria-label="Meme keyboard"
              >
                {selectedPackActions.map((a) => {
                  const isSending = sendingActionId === a.id;
                  const hasImage = !!a.image_url;
                  return (
                  <button
                    key={a.id}
                    className="button button-primary"
                      style={{
                        fontSize: '8pt',
                        padding: hasImage ? '6px' : '10px 8px',
                        minHeight: 44,
                        whiteSpace: 'normal',
                        lineHeight: 1.1,
                        opacity: !canInteract ? 0.7 : 1,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                      disabled={!canInteract || isSending}
                    title={a.render_text || a.title}
                      onPointerDown={() => onActionPointerDown(a)}
                      onPointerUp={() => onActionPointerUp(a)}
                      onPointerCancel={() => clearHoldTimer()}
                      onPointerLeave={() => clearHoldTimer()}
                    >
                      {hasImage && a.image_url ? (
                        <img
                          src={a.image_url}
                          alt={a.title}
                          style={{
                            width: '100%',
                            height: 54,
                            objectFit: 'cover',
                            border: '1px solid rgba(255,255,255,0.12)',
                            display: 'block',
                          }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : null}
                      <div style={{ width: '100%', textAlign: 'left' }}>
                        {isSending ? 'SENDING...' : a.title}
                      </div>
                    </button>
                  );
                })}

                {selectedPackActions.length === 0 ? (
                  <div style={{ color: '#757575', fontSize: '8pt' }}>No drops in this pack.</div>
                ) : null}
              </div>
            </div>
          ) : null}


          {!loading && user?.id && disabled ? (
            <div style={{ color: '#757575', fontSize: '8pt' }}>This vehicle is private. Drops are disabled.</div>
          ) : null}
        </div>
      </div>

      {preview ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPreview(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              width: 'min(520px, calc(100vw - 24px))',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: '10pt' }}>{preview.action.title}</div>
                <div style={{ fontSize: '8pt', color: '#6b7280' }}>
                  {preview.pack ? preview.pack.name : 'Unknown pack'}
                </div>
              </div>
              <button className="button button-secondary" onClick={() => setPreview(null)} style={{ fontSize: '9pt' }}>
                CLOSE
              </button>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {preview.action.image_url ? (
                <div
                  style={{
                    width: '100%',
                    border: '1px solid rgba(0,0,0,0.12)',
                    background: '#111',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 8,
                  }}
                >
                  <img
                    src={preview.action.image_url}
                    alt={preview.action.title}
                    style={{ maxWidth: '100%', maxHeight: 340, objectFit: 'contain', display: 'block' }}
                  />
                </div>
              ) : null}

              <div style={{ fontSize: '9pt', color: '#374151' }}>
                {preview.action.render_text || (!preview.action.image_url ? 'Preview unavailable.' : '')}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="button button-secondary" onClick={() => setPreview(null)} style={{ fontSize: '9pt' }}>
                  CANCEL
                </button>
                <button
                  className="button button-primary"
                  disabled={!canInteract || sendingActionId === preview.action.id}
                  onClick={() => {
                    void sendMeme(preview.action.id);
                    setPreview(null);
                  }}
                  style={{ fontSize: '9pt' }}
                >
                  {sendingActionId === preview.action.id ? 'SENDING...' : 'DROP'}
                  </button>
              </div>
              <div style={{ fontSize: '8pt', color: '#6b7280' }}>Tip: press Escape to close.</div>
            </div>
          </div>
      </div>
      ) : null}
    </div>
  );
}


