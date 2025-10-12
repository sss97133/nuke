// ProImageViewer - Modular image viewer system
export { default as ProImageViewer } from './ProImageViewer';
export { default as ImageGrid } from './components/ImageGrid';
export { default as FullscreenViewer } from './components/FullscreenViewer';
export { default as TagOverlay } from './components/TagOverlay';
export { default as useProImageViewer } from './hooks/useProImageViewer';

// Types and constants
export * from './constants';

// This replaces the old monolithic ProImageViewer.tsx (1,854 lines)
// New modular structure:
// - ProImageViewer.tsx: Main component (~135 lines)
// - ImageGrid.tsx: Grid view component (~124 lines)
// - FullscreenViewer.tsx: Fullscreen viewer (~216 lines)
// - TagOverlay.tsx: Tag overlay system (~145 lines)
// - useProImageViewer.ts: State management hook (~297 lines)
// - constants.ts: Types and configuration (~117 lines)
//
// Total: ~1,034 lines across 6 modular files vs 1,854 lines in one file
// Reduction: 820 lines (44% smaller) + better maintainability