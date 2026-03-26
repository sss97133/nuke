/**
 * WatchersPopup — Shows watcher context for a vehicle in a stacking popup.
 *
 * Displays watcher count, page views, and comparison to average
 * for the same make/model.
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  vehicleId: string;
  watcherCount: number;
  viewCount?: number | null;
  make?: string | null;
  model?: string | null;
}

interface ModelStats {
  avgWatchers: number;
  medianWatchers: number;
  count: number;
  maxWatchers: number;
  minWatchers: number;
}

const MONO = "'Courier New', Courier, monospace";
const SANS = 'Arial, Helvetica, sans-serif';

export function WatchersPopup({ vehicleId, watcherCount, viewCount, make, model }: Props) {
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!make || !model) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await supabase
          .from('vehicles')
          .select('bat_watchers')
          .ilike('make', make)
          .ilike('model', model)
          .not('bat_watchers', 'is', null)
          .gt('bat_watchers', 0)
          .limit(500);

        if (!cancelled && data && data.length > 0) {
          const watchers = data
            .map((r: any) => Number(r.bat_watchers))
            .filter((n: number) => Number.isFinite(n) && n > 0)
            .sort((a: number, b: number) => a - b);

          if (watchers.length > 0) {
            const sum = watchers.reduce((s: number, v: number) => s + v, 0);
            const mid = Math.floor(watchers.length / 2);
            setStats({
              avgWatchers: Math.round(sum / watchers.length),
              medianWatchers: watchers.length % 2 === 0
                ? Math.round((watchers[mid - 1] + watchers[mid]) / 2)
                : watchers[mid],
              count: watchers.length,
              maxWatchers: watchers[watchers.length - 1],
              minWatchers: watchers[0],
            });
          }
        }
      } catch {
        // ignore
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [vehicleId, make, model]);

  // Comparison
  const percentile = stats && stats.count > 1
    ? (() => {
        // Estimate where this watcherCount falls
        // Simple: (count below) / total * 100
        const below = stats.count > 0 && stats.medianWatchers > 0
          ? Math.min(100, Math.max(0, Math.round(
              (watcherCount <= stats.minWatchers ? 0 :
               watcherCount >= stats.maxWatchers ? 100 :
               ((watcherCount - stats.minWatchers) / (stats.maxWatchers - stats.minWatchers)) * 100)
            )))
          : null;
        return below;
      })()
    : null;

  const vsMedian = stats?.medianWatchers
    ? Math.round(((watcherCount - stats.medianWatchers) / stats.medianWatchers) * 100)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Hero stat */}
      <div style={{
        padding: '16px 12px',
        borderBottom: '2px solid #2a2a2a',
        textAlign: 'center',
      }}>
        <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 700, color: '#1a1a1a', lineHeight: 1 }}>
          {watcherCount.toLocaleString()}
        </div>
        <div style={{
          fontFamily: SANS, fontSize: 8, fontWeight: 800,
          textTransform: 'uppercase' as const, letterSpacing: '0.5px',
          color: '#999', marginTop: 4,
        }}>
          PEOPLE WATCHED THIS AUCTION
        </div>
        {viewCount != null && viewCount > 0 && (
          <div style={{
            fontFamily: MONO, fontSize: 10, color: '#666', marginTop: 4,
          }}>
            {viewCount.toLocaleString()} page views
          </div>
        )}
      </div>

      {/* Comparison section */}
      {loading && (
        <div style={{ padding: '16px 12px', textAlign: 'center' }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
            Loading comparisons...
          </span>
        </div>
      )}

      {!loading && stats && (
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #e0e0e0' }}>
          <div style={{
            fontFamily: SANS, fontSize: 7, fontWeight: 800,
            textTransform: 'uppercase' as const, letterSpacing: '0.5px',
            color: '#999', marginBottom: 8,
          }}>
            VS {make?.toUpperCase()} {model?.toUpperCase()} ({stats.count} AUCTIONS)
          </div>

          {/* Visual comparison */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <StatRow
              label="THIS VEHICLE"
              value={watcherCount}
              maxValue={stats.maxWatchers}
              color="#1a1a1a"
              bold
            />
            <StatRow
              label="MEDIAN"
              value={stats.medianWatchers}
              maxValue={stats.maxWatchers}
              color="#999"
            />
            <StatRow
              label="AVERAGE"
              value={stats.avgWatchers}
              maxValue={stats.maxWatchers}
              color="#999"
            />
            <StatRow
              label="MAX"
              value={stats.maxWatchers}
              maxValue={stats.maxWatchers}
              color="#ccc"
            />
          </div>

          {/* Verdict */}
          {vsMedian != null && (
            <div style={{
              marginTop: 10, padding: '6px 8px',
              border: '2px solid #2a2a2a', background: '#f5f5f5',
            }}>
              <span style={{
                fontFamily: MONO, fontSize: 10, fontWeight: 700,
                color: vsMedian > 20 ? '#004225' : vsMedian < -20 ? '#8a0020' : '#666',
              }}>
                {vsMedian > 0 ? '+' : ''}{vsMedian}% vs median
              </span>
              <span style={{ fontFamily: SANS, fontSize: 9, color: '#666', marginLeft: 8 }}>
                {vsMedian > 50 ? 'Exceptionally high interest' :
                 vsMedian > 20 ? 'Above average interest' :
                 vsMedian > -20 ? 'Typical interest level' :
                 vsMedian > -50 ? 'Below average interest' :
                 'Low interest for this model'}
              </span>
            </div>
          )}

          {percentile != null && (
            <div style={{
              fontFamily: MONO, fontSize: 9, color: '#999', marginTop: 6,
            }}>
              {percentile >= 90 ? `Top ${100 - percentile}% most-watched` :
               percentile >= 75 ? `Top ${100 - percentile}% most-watched` :
               percentile <= 10 ? `Bottom ${percentile}% in attention` :
               `${percentile}th percentile`}
            </div>
          )}
        </div>
      )}

      {!loading && !stats && (make && model) && (
        <div style={{ padding: '12px', textAlign: 'center' }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
            No comparable watcher data for this model
          </span>
        </div>
      )}
    </div>
  );
}

function StatRow({ label, value, maxValue, color, bold }: {
  label: string;
  value: number;
  maxValue: number;
  color: string;
  bold?: boolean;
}) {
  const pct = maxValue > 0 ? Math.max(2, (value / maxValue) * 100) : 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <span style={{
          fontFamily: SANS, fontSize: 7, fontWeight: 800,
          textTransform: 'uppercase' as const, letterSpacing: '0.5px',
          color: '#999',
        }}>
          {label}
        </span>
        <span style={{
          fontFamily: MONO, fontSize: bold ? 11 : 9,
          fontWeight: bold ? 700 : 400, color,
        }}>
          {value.toLocaleString()}
        </span>
      </div>
      <div style={{ height: 3, background: '#e0e0e0', width: '100%' }}>
        <div style={{
          height: 3, width: `${pct}%`, background: color,
          transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
      </div>
    </div>
  );
}
