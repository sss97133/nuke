import type { AccentId, ContrastProfile } from '../../contexts/ThemeContext';

export type AppearancePreset = {
  id: AccentId;
  name: string;
  pantoneExamples: string;
  chips: string[]; // hex
  defaultContrast?: ContrastProfile;
};

export const APPEARANCE_PRESETS: AppearancePreset[] = [
  {
    id: 'neutral',
    name: 'Neutral Workshop',
    pantoneExamples: 'Cool Gray family',
    chips: ['#2A2A2A', '#666666', '#BDBDBD'],
  },
  {
    id: 'gulf',
    name: 'Gulf',
    pantoneExamples: '290 C / 165 C',
    chips: ['#9DD9F3', '#FF5F00', '#F5F5F5'],
  },
  {
    id: 'martini',
    name: 'Martini Racing',
    pantoneExamples: '281 C / 299 C / 485 C',
    chips: ['#012169', '#00A3E0', '#DA291C'],
  },
  {
    id: 'ricard',
    name: 'Ricard',
    pantoneExamples: '286 C / 116 C',
    chips: ['#0033A0', '#FFCD00', '#F5F5F5'],
  },
  {
    id: 'rosso',
    name: 'Rosso Corsa',
    pantoneExamples: '185 C / 109 C',
    chips: ['#E4002B', '#FFD100', '#111111'],
  },
  {
    id: 'brg',
    name: 'British Racing Green',
    pantoneExamples: '343 C',
    chips: ['#00573F', '#FFEF00', '#2A2A2A'],
  },
  {
    id: 'jps',
    name: 'John Player Special',
    pantoneExamples: 'Black C / 871 C',
    chips: ['#111111', '#B9975B', '#F5F5F5'],
  },
  {
    id: 'jaeger',
    name: 'Jägermeister',
    pantoneExamples: '021 C',
    chips: ['#FE5000', '#111111', '#F5F5F5'],
  },
  {
    id: 'alitalia',
    name: 'Alitalia',
    pantoneExamples: '348 C / 186 C',
    chips: ['#009A44', '#C8102E', '#F5F5F5'],
  },
  {
    id: 'bmw-m',
    name: 'BMW M',
    pantoneExamples: '299 C / Reflex Blue C / 186 C',
    chips: ['#00A3E0', '#001489', '#C8102E'],
  },
  {
    id: 'papaya',
    name: 'Papaya',
    pantoneExamples: '1655 C',
    chips: ['#FF5F1F', '#111111', '#F5F5F5'],
  },
  {
    id: 'americana',
    name: 'Americana — Stars & Stripes',
    pantoneExamples: '282 C / 186 C / 663 C',
    chips: ['#0A2342', '#C8102E', '#F4F4F4'],
  },
  {
    id: 'route-66',
    name: 'Americana — Route 66',
    pantoneExamples: '3035 C / 4655 C',
    chips: ['#005F73', '#D4A373', '#F5F5F5'],
  },
  {
    id: 'denim',
    name: 'Americana — Denim',
    pantoneExamples: '2965 C / 7534 C',
    chips: ['#1B2A41', '#D6C9B4', '#F5F5F5'],
  },
  {
    id: 'desert',
    name: 'Americana — Desert Sun',
    pantoneExamples: '7576 C / 7554 C',
    chips: ['#C95A00', '#7B4B2A', '#F5F5F5'],
  },
  {
    id: 'camo-od',
    name: 'Camo — Olive Drab',
    pantoneExamples: '7771 C / 5743 C',
    chips: ['#4B5320', '#2A2A2A', '#F5F5F5'],
  },
  {
    id: 'camo-blaze',
    name: 'Camo — Blaze (Hunting)',
    pantoneExamples: '021 C / Black C',
    chips: ['#FE5000', '#111111', '#F5F5F5'],
  },
  {
    id: 'camo-snow',
    name: 'Camo — Snow / Hi-Vis',
    pantoneExamples: '663 C / 802 C',
    chips: ['#F4F4F4', '#44D62C', '#111111'],
  },
  {
    id: 'mopar-plum',
    name: 'Mopar — Plum Crazy',
    pantoneExamples: '2685 C',
    chips: ['#5B2C83', '#111111', '#F5F5F5'],
  },
  {
    id: 'mopar-sublime',
    name: 'Mopar — Sublime',
    pantoneExamples: '802 C / 375 C',
    chips: ['#44D62C', '#111111', '#F5F5F5'],
  },
  {
    id: 'mopar-hemi',
    name: 'Mopar — Hemi Orange',
    pantoneExamples: '165 C',
    chips: ['#FF5F00', '#111111', '#F5F5F5'],
  },
  {
    id: 'mopar-b5',
    name: 'Mopar — B5 Blue',
    pantoneExamples: '2995 C',
    chips: ['#00A3E0', '#111111', '#F5F5F5'],
  },
  {
    id: 'flames-heat',
    name: 'Flames — Heat',
    pantoneExamples: '165 C / 021 C',
    chips: ['#FF5F00', '#FE5000', '#111111'],
  },
  {
    id: 'flames-blue',
    name: 'Flames — Blue',
    pantoneExamples: 'Process Blue C / 299 C',
    chips: ['#0085CA', '#00A3E0', '#111111'],
  },
];


