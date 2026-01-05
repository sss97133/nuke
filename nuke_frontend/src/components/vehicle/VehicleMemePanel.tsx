import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { StreamActionsService, type StreamAction, type StreamActionPack } from '../../services/streamActionsService';
import { CashBalanceService } from '../../services/cashBalanceService';

type ActionPreview = {
  action: StreamAction;
  pack: StreamActionPack | null;
};

// Pack icons for visual distinction
const PACK_ICONS: Record<string, string> = {
  essentials: '⚡',
  reactions: '😎',
  chad: '💪',
  hater: '🙄',
  negative_energy: '😢',
  youtube: '📺',
  frog: '🐸',
  pepe: '🐸',
  left_wing: '🌹',
  right_wing: '🦅',
  incel: '🎮',
  memes: '🔥',
  meat_pipeline: '🥩',
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
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredAction, setHoveredAction] = useState<StreamAction | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const targetKey = `vehicle:${vehicleId}`;

  // Filter actions by search query
  const filteredActions = useMemo(() => {
    if (!searchQuery.trim()) return actions;
    const q = searchQuery.toLowerCase();
    return actions.filter(a => 
      a.title.toLowerCase().includes(q) ||
      a.tags?.some(t => t.toLowerCase().includes(q)) ||
      a.render_text?.toLowerCase().includes(q)
    );
  }, [actions, searchQuery]);

  const selectedPack = useMemo(() => {
    if (!selectedPackId) return null;
    return packs.find((p) => p.id === selectedPackId) || null;
  }, [packs, selectedPackId]);

  const selectedPackOwned = useMemo(() => {
    if (!selectedPackId) return false;
    return myPackIds.has(selectedPackId);
  }, [myPackIds, selectedPackId]);

  const selectedPackActions = useMemo(() => {
    if (!selectedPackId) return filteredActions;
    return filteredActions.filter((a) => a.pack_id === selectedPackId);
  }, [filteredActions, selectedPackId]);

  // Sort packs: owned first, then by name
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

  // Packs with memes only
  const packsWithMemes = useMemo(() => {
    const packActionCounts = new Map<string, number>();
    for (const a of actions) {
      packActionCounts.set(a.pack_id, (packActionCounts.get(a.pack_id) || 0) + 1);
    }
    return sortedPacks.filter(p => (packActionCounts.get(p.id) || 0) > 0);
  }, [sortedPacks, actions]);

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
        const allOwnedIds = new Set([...freePackIds, ...purchasedIds]);
        setMyPackIds(allOwnedIds);

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
    return () => { mounted = false; };
  }, [user?.id, vehicleId]);

  useEffect(() => {
    if (!packs.length) return;
    setSelectedPackId((prev) => {
      if (prev && packs.some((p) => p.id === prev)) return prev;
      // Default to first pack with memes
      const firstWithMemes = packs.find(p => actions.some(a => a.pack_id === p.id));
      return firstWithMemes?.id || packs[0].id;
    });
  }, [packs, myPackIds, actions]);

  const refreshPurchases = async () => {
    if (!user?.id) return;
    const purchases = await StreamActionsService.listMyPurchases(user.id);
    const freePackIds = new Set(packs.filter((pack) => pack.price_cents === 0).map((pack) => pack.id));
    const purchasedIds = new Set(purchases.map((x) => x.pack_id));
    setMyPackIds(new Set([...freePackIds, ...purchasedIds]));
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
      showToast('Pack unlocked! 🎉', 'success');
    } catch (e: any) {
      console.error('Purchase pack error:', e);
      showToast(e?.message || 'Purchase failed', 'error');
    } finally {
      setBuyingPackId(null);
    }
  };

  const sendMeme = useCallback(async (actionId: string) => {
    if (!user?.id) {
      showToast('Login required', 'warning');
      return;
    }
    try {
      setSendingActionId(actionId);
      await StreamActionsService.sendContentAction(targetKey, actionId);
      await refreshPurchases();
      showToast('Meme dropped! 🔥', 'success');
    } catch (e: any) {
      const msg = String(e?.message || 'Send failed');
      if (/cooldown/i.test(msg)) {
        showToast('Cooldown active ⏳', 'warning');
      } else if (/Insufficient/i.test(msg)) {
        showToast('Insufficient balance', 'error');
      } else {
        showToast(msg, 'error');
      }
    } finally {
      setSendingActionId(null);
    }
  }, [user?.id, targetKey, showToast]);

  const canInteract = !!user?.id && !disabled;
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

  const onActionPointerUp = (action: StreamAction, isOwned: boolean) => {
    if (holdTimerRef.current) {
      clearHoldTimer();
      if (isOwned && canInteract) {
        void sendMeme(action.id);
      }
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
      // Focus search on / key
      if (e.key === '/' && !preview && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview]);

  // Styles
  const panelStyle: React.CSSProperties = {
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.08)',
    overflow: 'hidden',
    boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
  };

  const headerStyle: React.CSSProperties = {
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'rgba(0,0,0,0.2)',
  };

  const packTabStyle = (isActive: boolean, isOwned: boolean): React.CSSProperties => ({
    padding: '8px 12px',
    borderRadius: '8px',
    border: 'none',
    background: isActive 
      ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' 
      : 'rgba(255,255,255,0.05)',
    color: isActive ? 'white' : isOwned ? '#e0e0e0' : '#888',
    fontSize: '11px',
    fontWeight: isActive ? 600 : 400,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    whiteSpace: 'nowrap',
  });

  const memeButtonStyle = (isOwned: boolean, isSending: boolean): React.CSSProperties => ({
    position: 'relative',
    padding: '4px',
    borderRadius: '8px',
    border: '2px solid transparent',
    background: 'rgba(255,255,255,0.05)',
    cursor: isOwned ? 'pointer' : 'not-allowed',
    opacity: isOwned ? 1 : 0.4,
    transition: 'all 0.15s ease',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    overflow: 'hidden',
    filter: isSending ? 'brightness(1.3)' : 'none',
  });

  const imageStyle: React.CSSProperties = {
    width: '100%',
    height: '64px',
    objectFit: 'cover',
    borderRadius: '6px',
    background: 'rgba(0,0,0,0.3)',
  };

  const textMemeStyle: React.CSSProperties = {
    width: '100%',
    height: '64px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #2d3748 0%, #1a202c 100%)',
    borderRadius: '6px',
    fontSize: '10px',
    fontWeight: 700,
    color: '#e0e0e0',
    textTransform: 'uppercase',
    padding: '4px',
    textAlign: 'center',
  };

  if (loading) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>
          <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '13px' }}>🎭 Meme Library</span>
        </div>
        <div style={{ padding: '32px', textAlign: 'center', color: '#888' }}>
          <div style={{ animation: 'pulse 1.5s infinite', fontSize: '24px' }}>🔄</div>
          <div style={{ marginTop: '8px', fontSize: '12px' }}>Loading memes...</div>
        </div>
      </div>
    );
  }

  if (!hasAnyPacks) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>
          <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '13px' }}>🎭 Meme Library</span>
        </div>
        <div style={{ padding: '32px', textAlign: 'center', color: '#888', fontSize: '12px' }}>
          No packs available yet.
        </div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>🎭</span>
          <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '13px' }}>Meme Library</span>
          <span style={{ 
            fontSize: '10px', 
            color: '#888', 
            background: 'rgba(255,255,255,0.1)', 
            padding: '2px 8px', 
            borderRadius: '10px' 
          }}>
            {actions.length} memes
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {typeof cashCents === 'number' && (
            <span style={{ fontSize: '11px', color: '#4ade80', fontWeight: 600 }}>
              ${(cashCents / 100).toFixed(2)}
            </span>
          )}
          {!user?.id && (
            <span style={{ fontSize: '10px', color: '#f59e0b' }}>Login to drop</span>
          )}
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ position: 'relative' }}>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search memes... (press /)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 32px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(0,0,0,0.3)',
              color: '#e0e0e0',
              fontSize: '12px',
              outline: 'none',
            }}
          />
          <span style={{ 
            position: 'absolute', 
            left: '10px', 
            top: '50%', 
            transform: 'translateY(-50%)',
            fontSize: '14px',
            opacity: 0.5,
          }}>
            🔍
          </span>
        </div>
      </div>

      {/* Pack Tabs */}
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        gap: '6px',
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}>
        <button
          onClick={() => setSelectedPackId('')}
          style={packTabStyle(!selectedPackId, true)}
        >
          <span>🌟</span>
          <span>All</span>
        </button>
        {packsWithMemes.map((p) => {
          const owned = myPackIds.has(p.id);
          const active = p.id === selectedPackId;
          const icon = PACK_ICONS[p.slug] || '📦';
          return (
            <button
              key={p.id}
              onClick={() => setSelectedPackId(p.id)}
              style={packTabStyle(active, owned)}
              title={p.description || p.name}
            >
              <span>{icon}</span>
              <span>{p.name}</span>
              {!owned && p.price_cents > 0 && (
                <span style={{ 
                  fontSize: '9px', 
                  background: 'rgba(0,0,0,0.3)', 
                  padding: '1px 4px', 
                  borderRadius: '4px' 
                }}>
                  ${(p.price_cents / 100).toFixed(2)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected Pack Header */}
      {selectedPack && !selectedPackOwned && selectedPack.price_cents > 0 && (
        <div style={{ 
          padding: '8px 16px', 
          background: 'rgba(245,158,11,0.1)', 
          borderBottom: '1px solid rgba(245,158,11,0.2)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '11px', color: '#f59e0b' }}>
            🔒 Unlock {selectedPack.name} to use these memes
          </span>
          <button
            onClick={() => purchasePack(selectedPack.id)}
            disabled={!canInteract || buyingPackId === selectedPack.id}
            style={{
              padding: '4px 12px',
              borderRadius: '6px',
              border: 'none',
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              color: 'white',
              fontSize: '11px',
              fontWeight: 600,
              cursor: canInteract ? 'pointer' : 'not-allowed',
              opacity: canInteract ? 1 : 0.6,
            }}
          >
            {buyingPackId === selectedPack.id ? '...' : `Unlock $${(selectedPack.price_cents / 100).toFixed(2)}`}
          </button>
        </div>
      )}

      {/* Meme Grid */}
      <div style={{ 
        padding: '12px',
        maxHeight: '320px',
        overflowY: 'auto',
        scrollbarWidth: 'thin',
      }}>
        {selectedPackActions.length === 0 ? (
          <div style={{ 
            padding: '32px', 
            textAlign: 'center', 
            color: '#888', 
            fontSize: '12px' 
          }}>
            {searchQuery ? 'No memes match your search' : 'No memes in this pack yet'}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
            gap: '8px',
          }}>
            {selectedPackActions.map((a) => {
              const pack = packs.find((p) => p.id === a.pack_id);
              const isOwned = pack ? myPackIds.has(pack.id) : false;
              const isSending = sendingActionId === a.id;
              const isHovered = hoveredAction?.id === a.id;
              const hasImage = !!a.image_url;

              return (
                <button
                  key={a.id}
                  style={{
                    ...memeButtonStyle(isOwned, isSending),
                    borderColor: isHovered ? 'rgba(102,126,234,0.5)' : 'transparent',
                    transform: isHovered ? 'scale(1.05)' : 'scale(1)',
                  }}
                  disabled={!canInteract || !isOwned || isSending}
                  title={`${a.title}${a.render_text ? ` - ${a.render_text}` : ''}`}
                  onMouseEnter={() => setHoveredAction(a)}
                  onMouseLeave={() => setHoveredAction(null)}
                  onPointerDown={() => isOwned && onActionPointerDown(a)}
                  onPointerUp={() => onActionPointerUp(a, isOwned)}
                  onPointerCancel={() => clearHoldTimer()}
                  onPointerLeave={() => clearHoldTimer()}
                >
                  {/* Lock indicator */}
                  {!isOwned && (
                    <div style={{
                      position: 'absolute',
                      top: '4px',
                      right: '4px',
                      fontSize: '10px',
                      background: 'rgba(0,0,0,0.7)',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      zIndex: 2,
                    }}>
                      🔒
                    </div>
                  )}

                  {/* Meme image or text */}
                  {hasImage ? (
                    <img
                      src={a.image_url!}
                      alt={a.title}
                      style={imageStyle}
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div style={textMemeStyle}>
                      {a.render_text || a.title}
                    </div>
                  )}

                  {/* Title */}
                  <div style={{
                    width: '100%',
                    fontSize: '9px',
                    color: '#ccc',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    padding: '0 2px',
                  }}>
                    {isSending ? '✨ Sending...' : a.title}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Hover Preview Tooltip */}
      {hoveredAction && hoveredAction.image_url && (
        <div style={{
          position: 'fixed',
          bottom: '100px',
          right: '20px',
          background: 'rgba(0,0,0,0.95)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '12px',
          padding: '8px',
          zIndex: 9998,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          maxWidth: '200px',
          pointerEvents: 'none',
        }}>
          <img
            src={hoveredAction.image_url}
            alt={hoveredAction.title}
            style={{
              width: '100%',
              maxHeight: '150px',
              objectFit: 'contain',
              borderRadius: '8px',
            }}
          />
          <div style={{ 
            marginTop: '6px', 
            fontSize: '11px', 
            color: '#e0e0e0',
            textAlign: 'center',
            fontWeight: 600,
          }}>
            {hoveredAction.title}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ 
        padding: '8px 16px', 
        borderTop: '1px solid rgba(255,255,255,0.05)',
        fontSize: '10px',
        color: '#666',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>Click to drop • Hold to preview</span>
        <span>Press / to search</span>
      </div>

      {/* Preview Modal */}
      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPreview(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.1)',
              width: 'min(480px, calc(100vw - 32px))',
              maxHeight: '80vh',
              overflow: 'hidden',
              boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
            }}
          >
            {/* Preview Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#e0e0e0' }}>
                  {preview.action.title}
                </div>
                <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                  {preview.pack?.name || 'Unknown Pack'}
                </div>
              </div>
              <button 
                onClick={() => setPreview(null)}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                ✕ Close
              </button>
            </div>

            {/* Preview Content */}
            <div style={{ padding: '20px' }}>
              {preview.action.image_url ? (
                <div style={{
                  background: 'rgba(0,0,0,0.4)',
                  borderRadius: '12px',
                  padding: '16px',
                  display: 'flex',
                  justifyContent: 'center',
                }}>
                  <img
                    src={preview.action.image_url}
                    alt={preview.action.title}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '300px',
                      objectFit: 'contain',
                      borderRadius: '8px',
                    }}
                  />
                </div>
              ) : (
                <div style={{
                  background: 'linear-gradient(135deg, #2d3748 0%, #1a202c 100%)',
                  borderRadius: '12px',
                  padding: '32px',
                  textAlign: 'center',
                  fontSize: '24px',
                  fontWeight: 700,
                  color: '#e0e0e0',
                }}>
                  {preview.action.render_text || preview.action.title}
                </div>
              )}

              {preview.action.render_text && preview.action.image_url && (
                <div style={{ 
                  marginTop: '12px', 
                  fontSize: '14px', 
                  color: '#ccc',
                  textAlign: 'center',
                }}>
                  "{preview.action.render_text}"
                </div>
              )}

              {/* Tags */}
              {preview.action.tags && preview.action.tags.length > 0 && (
                <div style={{ 
                  marginTop: '16px', 
                  display: 'flex', 
                  flexWrap: 'wrap', 
                  gap: '6px',
                  justifyContent: 'center',
                }}>
                  {preview.action.tags.map((tag, i) => (
                    <span key={i} style={{
                      background: 'rgba(102,126,234,0.2)',
                      color: '#a5b4fc',
                      padding: '3px 8px',
                      borderRadius: '12px',
                      fontSize: '10px',
                    }}>
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Preview Footer */}
            <div style={{
              padding: '16px 20px',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '12px',
            }}>
              <button
                onClick={() => setPreview(null)}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'transparent',
                  color: '#888',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void sendMeme(preview.action.id);
                  setPreview(null);
                }}
                disabled={!canInteract || sendingActionId === preview.action.id}
                style={{
                  padding: '10px 24px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: canInteract ? 'pointer' : 'not-allowed',
                  opacity: canInteract ? 1 : 0.6,
                }}
              >
                {sendingActionId === preview.action.id ? '✨ Sending...' : '🚀 Drop It!'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disabled Notice */}
      {disabled && user?.id && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '12px',
        }}>
          <div style={{ color: '#888', fontSize: '12px', textAlign: 'center' }}>
            🔒 Private vehicle<br/>
            <span style={{ fontSize: '10px' }}>Meme drops disabled</span>
          </div>
        </div>
      )}
    </div>
  );
}
