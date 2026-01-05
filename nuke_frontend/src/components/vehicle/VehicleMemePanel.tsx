import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { StreamActionsService, type StreamAction, type StreamActionPack } from '../../services/streamActionsService';

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
  const [sendingActionId, setSendingActionId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<StreamAction | null>(null);
  const holdTimerRef = useRef<number | null>(null);

  const targetKey = `vehicle:${vehicleId}`;

  // Only image memes
  const imageMemes = useMemo(() => {
    return actions.filter(a => a.image_url && myPackIds.has(a.pack_id));
  }, [actions, myPackIds]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        setLoading(true);
        const p = await StreamActionsService.listPacks();
        if (!mounted) return;
        setPacks(p);

        const freePackIds = new Set(p.filter((pack) => pack.price_cents === 0).map((pack) => pack.id));

        if (!user?.id) {
          setMyPackIds(freePackIds);
          const act = await StreamActionsService.listActionsForPacks(Array.from(freePackIds));
          if (!mounted) return;
          setActions(act);
          return;
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
        console.error('Meme load error:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    run();
    return () => { mounted = false; };
  }, [user?.id, vehicleId]);

  const sendMeme = useCallback(async (actionId: string) => {
    if (!user?.id) {
      showToast('Login required', 'warning');
      return;
    }
    try {
      setSendingActionId(actionId);
      await StreamActionsService.sendContentAction(targetKey, actionId);
      showToast('Dropped', 'success');
    } catch (e: any) {
      const msg = String(e?.message || 'Failed');
      if (/cooldown/i.test(msg)) {
        showToast('Cooldown', 'warning');
      } else {
        showToast(msg, 'error');
      }
    } finally {
      setSendingActionId(null);
    }
  }, [user?.id, targetKey, showToast]);

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const onPointerDown = (action: StreamAction) => {
    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      setPreview(action);
    }, 400);
  };

  const onPointerUp = (action: StreamAction) => {
    if (holdTimerRef.current) {
      clearHoldTimer();
      if (user?.id && !disabled) {
        void sendMeme(action.id);
      }
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const canInteract = !!user?.id && !disabled;

  // Collapsed: show first 6 memes in a row
  // Expanded: show all in grid
  const visibleMemes = expanded ? imageMemes : imageMemes.slice(0, 6);
  const hasMore = imageMemes.length > 6;

  if (loading) {
    return (
      <div className="card">
        <div className="card-body" style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '9pt' }}>
          Loading...
        </div>
      </div>
    );
  }

  if (imageMemes.length === 0) {
    return null;
  }

  return (
    <div className="card">
      <div className="card-body" style={{ padding: '8px' }}>
        {!user?.id && (
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
            Login to drop memes
          </div>
        )}
        
        <div style={{
          display: 'flex',
          flexWrap: expanded ? 'wrap' : 'nowrap',
          gap: '6px',
          overflowX: expanded ? 'visible' : 'auto',
          paddingBottom: expanded ? 0 : '4px',
        }}>
          {visibleMemes.map((a) => {
            const isSending = sendingActionId === a.id;
            return (
              <button
                key={a.id}
                style={{
                  flex: expanded ? '0 0 auto' : '0 0 56px',
                  width: expanded ? '56px' : '56px',
                  height: '56px',
                  padding: '2px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  cursor: canInteract ? 'pointer' : 'not-allowed',
                  opacity: canInteract ? 1 : 0.5,
                  position: 'relative',
                  overflow: 'hidden',
                }}
                disabled={!canInteract || isSending}
                title={a.title}
                onPointerDown={() => canInteract && onPointerDown(a)}
                onPointerUp={() => canInteract && onPointerUp(a)}
                onPointerCancel={clearHoldTimer}
                onPointerLeave={clearHoldTimer}
              >
                <img
                  src={a.image_url!}
                  alt={a.title}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: '4px',
                    filter: isSending ? 'brightness(1.5)' : 'none',
                  }}
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </button>
            );
          })}
          
          {!expanded && hasMore && (
            <button
              onClick={() => setExpanded(true)}
              style={{
                flex: '0 0 56px',
                width: '56px',
                height: '56px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9pt',
                color: 'var(--text-muted)',
              }}
            >
              +{imageMemes.length - 6}
            </button>
          )}
        </div>
        
        {expanded && hasMore && (
          <div style={{ marginTop: '8px', textAlign: 'center' }}>
            <button
              className="button button-secondary"
              onClick={() => setExpanded(false)}
              style={{ fontSize: '8pt', padding: '4px 12px' }}
            >
              Collapse
            </button>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {preview && (
        <div
          onClick={() => setPreview(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: 'min(320px, 90vw)', maxHeight: '80vh' }}
          >
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{preview.title}</span>
              <button 
                className="button button-secondary" 
                onClick={() => setPreview(null)}
                style={{ padding: '4px 8px', fontSize: '9pt' }}
              >
                X
              </button>
            </div>
            <div className="card-body" style={{ padding: '12px' }}>
              <img
                src={preview.image_url!}
                alt={preview.title}
                style={{
                  width: '100%',
                  maxHeight: '240px',
                  objectFit: 'contain',
                  borderRadius: '4px',
                  background: 'var(--bg)',
                }}
              />
              <div style={{ marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  className="button button-secondary"
                  onClick={() => setPreview(null)}
                  style={{ fontSize: '9pt' }}
                >
                  Cancel
                </button>
                <button
                  className="button button-primary"
                  disabled={!canInteract || sendingActionId === preview.id}
                  onClick={() => {
                    void sendMeme(preview.id);
                    setPreview(null);
                  }}
                  style={{ fontSize: '9pt' }}
                >
                  {sendingActionId === preview.id ? 'Sending...' : 'Drop'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
