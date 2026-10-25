import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ rpc:vi.fn(), getSession:vi.fn(), unsubscribe:vi.fn(), authChanged:null as null | ((event:string, session:{user:{id:string}} | null)=>void) }));
const rpc = fixture.rpc;
vi.mock('../../lib/supabase', () => ({ supabase: { rpc:fixture.rpc, auth: {
  getSession:fixture.getSession,
  onAuthStateChange:(callback:typeof fixture.authChanged)=>{fixture.authChanged=callback;return {data:{subscription:{unsubscribe:fixture.unsubscribe}}};},
} } }));

import { warmJobRoute, warmRead } from './jobWarm';
import { readJob } from './readJob';

const WO = '3df0f925-1b79-49b4-9181-fd0f4c6e14ad';

describe('job path warm-up', () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { display_title: 'Job' }, error: null }); fixture.getSession.mockReset().mockResolvedValue({data:{session:null},error:null}); fixture.unsubscribe.mockReset(); });

  it('starts the job path read for a direct /jobs/:id load and hands it to the page once', async () => {
    await warmJobRoute(`/jobs/${WO}`);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await readJob('work_order_job_path_read', { p_work_order_id: WO }, null)).toEqual({ status: 'loaded', data: { display_title: 'Job' } });
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

it('does not consume a warm result belonging to another viewer or an unresolved viewer', async () => {
  const args = {p_work_order_id: '00000000-0000-4000-a000-000000000099'};
  rpc.mockResolvedValueOnce({data:{private_note:'ONLY A'},error:null}).mockResolvedValue({data:{public_title:'Public job'},error:null});
  warmRead('work_order_job_path_read', args, 'viewer-a');
  expect(await readJob('work_order_job_path_read', args, 'viewer-b')).toEqual({status:'loaded',data:{public_title:'Public job'}});
  expect(await readJob('work_order_job_path_read', args)).toEqual({status:'loaded',data:{public_title:'Public job'}});
  expect(await readJob('work_order_job_path_read', args, 'viewer-a')).toEqual({status:'loaded',data:{private_note:'ONLY A'}});
});


it('discards a warm response if identity changes while its token or response is pending', async () => {
  const id = '00000000-0000-4000-a000-000000000098';
  let finish!: (result:unknown)=>void;
  fixture.getSession.mockResolvedValue({data:{session:{user:{id:'viewer-a'}}},error:null});
  fixture.unsubscribe.mockReset();
  rpc.mockReset().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const warming=warmJobRoute(`/jobs/${id}`);
  await Promise.resolve(); await Promise.resolve();
  fixture.authChanged!('SIGNED_IN',{user:{id:'viewer-b'}});
  finish({data:{private_note:'ONLY B'},error:null}); await warming;
  rpc.mockResolvedValue({data:{public_title:'Fresh A read'},error:null});
  expect(await readJob('work_order_job_path_read',{p_work_order_id:id},'viewer-a')).toEqual({status:'loaded',data:{public_title:'Fresh A read'}});
  expect(fixture.unsubscribe).toHaveBeenCalledOnce();
});

it('does not start a warm RPC when the session sample was superseded before it resolved', async () => {
  const id='00000000-0000-4000-a000-000000000097';
  let finish!: (result:unknown)=>void;
  fixture.getSession.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})); rpc.mockReset();
  const warming=warmJobRoute(`/jobs/${id}`);
  fixture.authChanged!('SIGNED_IN',{user:{id:'viewer-b'}});
  finish({data:{session:{user:{id:'viewer-a'}}},error:null}); await warming;
  expect(rpc).not.toHaveBeenCalled();
});
