export const useMemoryUsage = (): number => {
  // @ts-ignore - performance.memory exists in Chrome
  if (performance && performance.memory) {
    // @ts-ignore - accessing memory property
    return Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
  }
  return 0;
};