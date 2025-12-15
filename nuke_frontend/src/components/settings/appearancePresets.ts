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
];


