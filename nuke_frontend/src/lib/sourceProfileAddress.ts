/** Routing only. The authenticated source reader owns evidence admission and eligibility. */
export function sourceVehicleProfilePath(value: string): string | null {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/$/, '');
    if (url.protocol !== 'https:' || url.hostname !== 'exclusivecarregistry.com' || url.port || url.username || url.password || url.search || url.hash
      || !/^\/(collection\/[a-z0-9_-]+|details\/[a-z0-9_-]+\/[a-z0-9_-]+\/[1-9][0-9]*)$/i.test(path)) return null;
    return `/vehicle/source?source_url=${encodeURIComponent(url.origin + path)}`;
  } catch { return null; }
}
