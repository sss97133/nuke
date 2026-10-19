import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }));

import { warmJobRoute } from './jobWarm';
import { readJob } from './readJob';

const WO = '3df0f925-1b79-49b4-9181-fd0f4c6e14ad';

describe('job path warm-up', () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { display_title: 'Job' }, error: null }); });

  it('starts the job path read for a direct /jobs/:id load and hands it to the page once', async () => {
    warmJobRoute(`/jobs/${WO}`);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await readJob('work_order_job_path_read', { p_work_order_id: WO })).toEqual({ status: 'loaded', data: { display_title: 'Job' } });
    expect(rpc).toHaveBeenCalledTimes(1);
    await readJob('work_order_job_path_read', { p_work_order_id: WO });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('warms nothing on other routes', () => {
    warmJobRoute('/jobs');
    warmJobRoute('/jobs/not-a-uuid');
    warmJobRoute('/vehicle/abc');
    expect(rpc).not.toHaveBeenCalled();
  });
});
