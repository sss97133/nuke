import { atom } from 'jotai';

export type Theme = 'ios' | 'figma' | 'shadcn' | 'glass';

export const themeAtom = atom<Theme>('shadcn'); 