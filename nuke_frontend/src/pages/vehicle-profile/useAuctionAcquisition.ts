import { useEffect, useState } from 'react';
import { useVehicleEvents } from '../../hooks/useVehicleEvents';
import { auctionAcquisitionState } from './auctionAcquisitionState';

export function useAuctionAcquisition(vehicleId: string | undefined) {
  const query = useVehicleEvents(vehicleId);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  const episodes = (query.data ?? []).flatMap(event => {
    const state = auctionAcquisitionState(event, now);
    return state ? [{ event, state }] : [];
  });
  // A later/current offer takes priority over a historical appearance of the same car.
  const current = episodes.find(({ state }) => state.timer != null) ?? episodes[0];
  return { ...query, episodes, current, now };
}
