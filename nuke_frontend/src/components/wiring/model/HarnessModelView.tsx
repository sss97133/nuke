// The MODEL tab: the harness model measuring itself (stack SH's scoreboard), one kit Measures block per layer of the
// data machine, from one typed read. Owner-only, like the other non-MAP tabs: it is process state, not results.
import { Measures, Text } from '../../../kit';
import { useHarnessScoreboard } from './harnessScoreboard';
import './harness-model.css';

export default function HarnessModelView({ vehicleId }: { vehicleId: string | undefined }) {
  const { layers, error } = useHarnessScoreboard(vehicleId);
  if (layers === null) return null;
  if (error) return <div className="harness-model"><Text role="caption">scoreboard unavailable: {error}</Text></div>;
  if (layers.length === 0) return <div className="harness-model"><Text role="caption">no harness model for this vehicle</Text></div>;
  return (
    <div className="harness-model" aria-label="Harness data model scoreboard">
      {layers.map(l => (
        <Measures key={l.layer} title={l.title} coverage={l.coverage} items={l.items} ariaLabel={`${l.title} measures`} />
      ))}
    </div>
  );
}
