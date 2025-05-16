
export function assert(condition: boolean, message: string): boolean {
  if (!condition) {
    console.error(`[GarageSelector] Assertion failed: ${message}`);
    return false;
  }
  return true;
}
