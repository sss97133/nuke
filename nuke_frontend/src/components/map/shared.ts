// Shared map utilities — FIPS lookups, colorways, types

import { MAP_FONT } from './constants';

// ─── FIPS lookups ──────────────────────────────────────────────────────────────
export const COUNTY_NAMES: Record<string, string> = {};
let _namesLoaded = false;
export async function ensureCountyNames() {
  if (_namesLoaded) return;
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json');
    const topo = await res.json();
    const geoms = topo.objects?.counties?.geometries ?? [];
    for (const g of geoms) {
      if (g.id && g.properties?.name) {
        COUNTY_NAMES[String(g.id)] = g.properties.name;
      }
    }
  } catch { /* names are optional */ }
  _namesLoaded = true;
}

export const STATE_FIPS: Record<string, string> = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE',
  '11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA',
  '20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN',
  '28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM',
  '36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI',
  '45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA',
  '54':'WV','55':'WI','56':'WY',
};

// ─── Colorway system ───────────────────────────────────────────────────────────
export type ColorwayId = 'amber' | 'plasma' | 'viridis' | 'heat';

export interface Colorway {
  label: string;
  basemap: 'dark' | 'light';
  blendMode: string;
  tileUrl: string;
  empty: string;
  border: string;
  hoverBorder: string;
  stops: [number, string][];
}

export const COLORWAY_IDS: ColorwayId[] = ['amber', 'plasma', 'viridis', 'heat'];

export const COLORWAYS: Record<ColorwayId, Colorway> = {
  amber: {
    label: 'AMBER',
    basemap: 'dark',
    blendMode: 'screen',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    empty: 'transparent',
    border: 'rgba(80,70,50,0.12)',
    hoverBorder: 'rgba(245, 158, 11, 0.8)',
    stops: [
      [0,    'rgba(30, 20, 5, 0.08)'],
      [1,    'rgba(80, 50, 10, 0.15)'],
      [5,    'rgba(140, 90, 10, 0.22)'],
      [15,   'rgba(200, 130, 10, 0.3)'],
      [50,   'rgba(235, 155, 10, 0.38)'],
      [150,  'rgba(245, 130, 10, 0.46)'],
      [500,  'rgba(255, 80, 5, 0.54)'],
      [1000, 'rgba(255, 30, 0, 0.62)'],
    ],
  },
  plasma: {
    label: 'PLASMA',
    basemap: 'dark',
    blendMode: 'screen',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    empty: 'transparent',
    border: 'rgba(50,40,80,0.12)',
    hoverBorder: 'rgba(240, 220, 60, 0.8)',
    stops: [
      [0,    'rgba(10, 5, 25, 0.08)'],
      [1,    'rgba(50, 10, 80, 0.15)'],
      [5,    'rgba(120, 20, 110, 0.22)'],
      [15,   'rgba(180, 40, 70, 0.3)'],
      [50,   'rgba(230, 80, 25, 0.38)'],
      [150,  'rgba(245, 150, 15, 0.46)'],
      [500,  'rgba(248, 210, 40, 0.54)'],
      [1000, 'rgba(240, 245, 80, 0.62)'],
    ],
  },
  viridis: {
    label: 'VIRIDIS',
    basemap: 'light',
    blendMode: 'multiply',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    empty: 'transparent',
    border: 'rgba(150,150,145,0.15)',
    hoverBorder: 'rgba(30, 30, 30, 0.7)',
    stops: [
      [0,    'rgba(255, 255, 250, 0.02)'],
      [1,    'rgba(68, 1, 84, 0.2)'],
      [5,    'rgba(59, 82, 139, 0.3)'],
      [15,   'rgba(33, 144, 140, 0.38)'],
      [50,   'rgba(93, 201, 98, 0.45)'],
      [150,  'rgba(170, 220, 50, 0.5)'],
      [500,  'rgba(230, 245, 35, 0.55)'],
      [1000, 'rgba(253, 231, 37, 0.6)'],
    ],
  },
  heat: {
    label: 'HEAT',
    basemap: 'light',
    blendMode: 'multiply',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    empty: 'transparent',
    border: 'rgba(180,175,170,0.15)',
    hoverBorder: 'rgba(30, 30, 30, 0.7)',
    stops: [
      [0,    'rgba(255, 255, 250, 0.02)'],
      [1,    'rgba(255, 235, 210, 0.2)'],
      [5,    'rgba(255, 200, 140, 0.3)'],
      [15,   'rgba(255, 155, 70, 0.38)'],
      [50,   'rgba(240, 100, 35, 0.45)'],
      [150,  'rgba(210, 50, 25, 0.5)'],
      [500,  'rgba(170, 15, 15, 0.55)'],
      [1000, 'rgba(110, 0, 5, 0.6)'],
    ],
  },
};

export function countyColor(count: number, colorway: Colorway): string {
  const stops = colorway.stops;
  for (let i = stops.length - 1; i >= 0; i--) {
    if (count >= stops[i][0]) return stops[i][1];
  }
  return stops[0][1];
}

// ─── Drill levels ──────────────────────────────────────────────────────────────
export const ZOOM_STATE = 5;
export const ZOOM_COUNTY = 9;

export type DrillLevel = 'state' | 'county' | 'points';

export function zoomToLevel(zoom: number): DrillLevel {
  if (zoom <= ZOOM_STATE) return 'state';
  if (zoom <= ZOOM_COUNTY) return 'county';
  return 'points';
}
