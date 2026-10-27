import { describe, expect, it } from 'vitest';
import { parseScene3d, scene3dPatch } from './scene3d';

const P = (q: string) => parseScene3d(new URLSearchParams(q));

describe('parseScene3d', () => {
  it('reads nothing from an empty URL', () => {
    expect(P('')).toEqual({ cam: null, pose: null, layers: null, zones: null, client: null, tone: 'neutral' });
  });
  it('maps side to the driver view and drops unknown cameras', () => {
    expect(P('cam=side').cam).toBe('driver');
    expect(P('cam=fit').cam).toBe('fit');
    expect(P('cam=nonsense').cam).toBeNull();
  });
  it('takes a pose only as six finite numbers', () => {
    expect(P('pose=1,2,3,4,5,6').pose).toEqual([1, 2, 3, 4, 5, 6]);
    expect(P('pose=1,2,3').pose).toBeNull();
    expect(P('pose=1,2,3,4,5,x').pose).toBeNull();
  });
  it('lists layers and zones, drops unknown ids, and harness=off is no zones', () => {
    const r = P('layers=frame,engine,bogus&harness=off');
    expect([...r.layers!]).toEqual(['frame', 'engine']);
    expect(r.zones!.size).toBe(0);
    expect([...P('harness=bay,rear,x').zones!]).toEqual(['bay', 'rear']);
    expect(P('layers=').layers!.size).toBe(0);
  });
  it('reads client and tone', () => {
    expect(P('client=1').client).toBe(true);
    expect(P('client=0').client).toBe(false);
    expect(P('tone=aces').tone).toBe('aces');
  });
});

describe('scene3dPatch', () => {
  it('describes exactly what is drawn', () => {
    const p = scene3dPatch(new Set(), { sheetmetal: false, firewall: false });
    expect(p.harness).toBe('off');
    expect(p.layers.split(',')).toContain('frame');
    expect(p.layers.split(',')).not.toContain('firewall');
    expect(scene3dPatch(new Set(['bay', 'cab']), {}).harness).toBe('bay,cab');
  });
});
