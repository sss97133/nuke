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
        <div className="card-body">
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
      <div className="card-body">
        {!user?.id && (
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
            Login to drop memes
          </div>
        )}
        
        <div style={{
          display: 'flex',
          flexWrap: expanded ? 'wrap' : 'nowrap',
          gap: 'var(--space-1)',
          overflowX: expanded ? 'visible' : 'auto',
        }}>
          {visibleMemes.map((a) => {
            const isSending = sendingActionId === a.id;
            return (
              <button
                key={a.id}
                className="button"
                style={{
                  flex: expanded ? '0 0 auto' : '0 0 48px',
                  width: '48px',
                  height: '48px',
                  padding: 0,
                  minHeight: 0,
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
                    filter: isSending ? 'brightness(1.3)' : 'none',
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
              className="button button-secondary"
              onClick={() => setExpanded(true)}
              style={{
                flex: '0 0 48px',
                width: '48px',
                height: '48px',
                padding: 0,
                minHeight: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '8pt',
              }}
            >
              +{imageMemes.length - 6}
            </button>
          )}
        </div>
        
        {expanded && hasMore && (
          <div style={{ marginTop: 'var(--space-2)', textAlign: 'center' }}>
            <button
              className="button button-secondary"
              onClick={() => setExpanded(false)}
              style={{ fontSize: '8pt' }}
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
            <div className="card-header">
              {preview.title}
            </div>
            <div className="card-body">
              <img
                src={preview.image_url!}
                alt={preview.title}
                style={{
                  width: '100%',
                  maxHeight: '240px',
                  objectFit: 'contain',
                  background: 'var(--bg)',
                }}
              />
              <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                <button
                  className="button button-secondary"
                  onClick={() => setPreview(null)}
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
