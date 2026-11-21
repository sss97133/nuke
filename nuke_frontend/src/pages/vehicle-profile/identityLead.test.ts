import { describe, expect, it } from 'vitest';
import { identityLead } from './identityLead';

const item = (key: string, stated: string) => ({ key, stated, value: null }) as never;

describe('identityLead', () => {
  it('says plainly that a tribute is not the factory trim, from the VIN decode and the engine readings', () => {
    const lead = identityLead({ trim: [item('trim.decode', 'Firebird')], engine: [item('engine.as_built.engine', '250'), item('engine.current.displacement', '455')] }, 'Trans Am');
    expect(lead).toBe('A tribute, not a factory Trans Am: the VIN decodes to Firebird. Built with a 250 engine; it now carries a 455, not the original.');
  });
  it('says nothing without a VIN decode, and never fills a missing engine', () => {
    expect(identityLead({ engine: [item('engine.current.displacement', '455')] }, 'Trans Am')).toBeNull();
    expect(identityLead({ trim: [item('trim.decode', 'Firebird')] }, 'Trans Am*')).toBe('A tribute, not a factory Trans Am: the VIN decodes to Firebird.');
  });
});
