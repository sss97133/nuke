"""Offline contract; no credentials, network, model calls, or testimony writes."""
import copy
import unittest
import tempfile
import os
import json
import keys_lane as lane
import keys_resume as resume

V='10000000-0000-4000-8000-000000000001'
U='10000000-0000-4000-8000-000000000002'
P='20000000-0000-4000-8000-000000000001'
S='30000000-0000-4000-8000-000000000001'

def plan():
    texts=['Paint is flaking on the driver door.', 'Driver door panel has visible deformation.']
    photo=dict(id=P,vehicle_id=V,user_id=U,taken_at='2026-11-10T12:00:00Z',created_at='2026-11-10T12:00:00Z',image_url='https://example.invalid/a.jpg',file_hash='retained-photo-bytes',scene='exterior_detail',callouts=texts,reader_model='retained-reader',prompt_version='retained-v1',is_superseded=False,superseded_by=None,is_sensitive=False,is_document=False,is_duplicate=False)
    source=dict(id=S,vehicle_id=V,source_url=photo['image_url'],extraction_method='reviewed_image_analysis_v1',is_superseded=False,superseded_by=None,content_hash='source-hash',structured_data={'image_id':P,'damage_callouts':texts},agent_model='retained-reader')
    states=['exterior.paint.delamination','exterior.body.deformation']
    cached={'photo':P[:8],'proposals':[],'unsure':'nothing','results':[{'sid':f'c{i}','claims':[{'part':{'decision':'existing','key':'door.front.driver','side':'driver'},'state':{'decision':'condition_key','property_key':None,'value_or_key':states[i]},'said':text}],'not_a_claim':None,'question':None} for i,text in enumerate(texts)]}
    registry={'subjects':{'door.front.driver':'driver'},'conditions':dict.fromkeys(states),'subject_ids':{'door.front.driver':'40000000-0000-4000-8000-000000000001'},'condition_ids':{key:f'50000000-0000-4000-8000-00000000000{i}' for i,key in enumerate(states)}}
    decisions={'parts':{},'states':{}}
    unit={'photo':photo,'source':source,'photo_version':resume.digest(photo),'source_version':resume.digest(source),'selectors':{'0':['damage_callouts','0'],'1':['damage_callouts','1']},'cached':cached,'keying_model':'retained-keyer'}
    return {'version':1,'vehicle_id':V,'user_id':U,'units':[unit],'registry':registry,'registry_version':resume.digest(registry),'decisions':decisions,'decisions_version':resume.digest(decisions),'deadline':100,'limits':{'units':2,'requests':4,'model_calls':0,'model_tokens':0}}

class Memory:
    def __init__(self):self.state=None
    def save(self,state):self.state=copy.deepcopy(state)

class Transport:
    def __init__(self,memory):self.memory=memory;self.rows={};self.posts=[];self.timeout=False;self.commit=True;self.changed=False;self.visible=True;self.has_witness=True
    def qualify(self,unit,body,deadline):resume.require(not self.changed,'source_changed')
    def find(self,body,deadline):return self.rows.get(body['source_identifier'],[])
    def put(self,body):self.rows[body['source_identifier']]=[dict(body,id='40000000-0000-4000-8000-000000000001',descriptor_id=plan()['registry']['condition_ids'][body['descriptor_key']],content_hash=resume.content_hash(body),is_superseded=False,superseded_by=None)]
    def post(self,body,deadline):
        assert self.memory.state['claims'][body['source_identifier']]['phase']=='request_pending'
        self.posts.append(copy.deepcopy(body))
        if self.commit:self.put(body)
        if self.timeout:raise TimeoutError()
    def witness(self,*args):return self.has_witness
    def consumer(self,*args):return self.visible

class Tests(unittest.TestCase):
    def test_live_transport_cannot_write_without_atomic_source_contract(self):
        transport = resume.LiveTransport({}, lane, {})
        with self.assertRaisesRegex(resume.Hold, 'atomic_source_admission'):
            transport.post({}, 100)

    def test_empty_checkpoint_is_not_a_new_budget(self):
        m=Memory();m.state={};t=Transport(m)
        with self.assertRaisesRegex(resume.Hold, 'checkpoint_invalid'):
            self.run_plan(plan(),m,t)
        self.assertEqual(m.state,{})
        self.assertFalse(t.posts)

    def run_plan(self,p,m,t,write=True,now=1):return resume.resume(p,m.state,t,m.save,lane,write,lambda:now)
    def test_partial_photo_resumes_each_claim(self):
        p=plan();m=Memory();t=Transport(m);claims,_=resume.prepare(p,lane);t.put(claims[0]['body'])
        self.assertEqual(self.run_plan(p,m,t)['phase'],'consumer_verified');self.assertEqual(len(t.posts),1)
        self.run_plan(p,m,t);self.assertEqual(len(t.posts),1)
    def test_commit_timeout_reconciles_without_resend(self):
        p=plan();m=Memory();t=Transport(m);t.timeout=True
        self.run_plan(p,m,t);self.assertEqual(len(t.posts),2);self.run_plan(p,m,t);self.assertEqual(len(t.posts),2)
    def test_unknown_and_partial_stop(self):
        for mode in ['no_commit','missing_witness']:
            p=plan();m=Memory();t=Transport(m);t.timeout=True;t.commit=mode!='no_commit';t.has_witness=mode!='missing_witness'
            with self.assertRaises(resume.Hold):self.run_plan(p,m,t)
            with self.assertRaises(resume.Hold):self.run_plan(p,m,t)
            self.assertEqual(len(t.posts),1)
    def test_same_second_distinct_photos(self):
        p=plan();other=copy.deepcopy(p['units'][0]);other['photo']['id']='20000000-0000-4000-8000-000000000002';other['source']['id']='30000000-0000-4000-8000-000000000002';other['source']['structured_data']['image_id']=other['photo']['id'];other['source_version']=resume.digest(other['source']);other['cached']['photo']=other['photo']['id'][:8];other['photo_version']=resume.digest(other['photo']);p['units'].append(other)
        claims,_=resume.prepare(p,lane);self.assertEqual(len({c['body']['source_identifier'] for c in claims}),4)
    def test_changed_source_stops_and_date_does_not_change_payload(self):
        p=plan();a,_=resume.prepare(p,lane);b,_=resume.prepare(copy.deepcopy(p),lane);self.assertEqual(a,b)
        m=Memory();t=Transport(m);t.changed=True
        with self.assertRaisesRegex(resume.Hold,'source_changed'):self.run_plan(p,m,t)
        self.assertEqual(t.posts,[])
    def test_negation(self):
        p=plan();u=p['units'][0];u['photo']['callouts'][0]='No paint is flaking on the driver door.';u['source']['structured_data']['damage_callouts'][0]=u['photo']['callouts'][0];u['cached']['results'][0]['claims'][0]['said']='paint is flaking on the driver door';u['source_version']=resume.digest(u['source']);u['photo_version']=resume.digest(u['photo'])
        with self.assertRaisesRegex(resume.Hold,'negation'):resume.prepare(p,lane)
    def test_missing_vocabulary_and_unsupported_source_are_dependencies(self):
        p=plan();p['registry']['conditions'].pop('exterior.body.deformation');p['registry']['condition_ids'].pop('exterior.body.deformation');p['registry_version']=resume.digest(p['registry']);claims,dependencies=resume.prepare(p,lane);self.assertFalse(claims);self.assertTrue(dependencies)
        p=plan();p['units'][0]['photo']['callouts']=[];p['units'][0]['photo_version']=resume.digest(p['units'][0]['photo']);self.assertTrue(resume.prepare(p,lane)[1])
    def test_budgets_and_deadline(self):
        for cap in ['requests','units','model_calls','model_tokens']:
            p=plan();p['limits'][cap]=0 if cap in ['requests','units'] else 1;m=Memory();t=Transport(m)
            with self.assertRaises(resume.Hold):self.run_plan(p,m,t)
            self.assertEqual(t.posts,[])
        p=plan();m=Memory();t=Transport(m)
        with self.assertRaisesRegex(resume.Hold,'deadline'):self.run_plan(p,m,t,now=100)
        self.assertEqual(m.state['deadline'],100)
    def test_same_identity_changed_payload_holds(self):
        p=plan();m=Memory();t=Transport(m);claims,_=resume.prepare(p,lane);t.put(claims[0]['body']);t.rows[claims[0]['body']['source_identifier']][0]['content_hash']='different'
        with self.assertRaisesRegex(resume.Hold,'identity_payload_conflict'):self.run_plan(p,m,t)
        self.assertFalse(t.posts)
    def test_admission_is_not_consumer_success(self):
        p=plan();m=Memory();t=Transport(m);t.visible=False
        self.assertEqual(self.run_plan(p,m,t)['phase'],'consumer_unresolved')
        self.assertTrue(all(c['phase']=='consumer_unresolved' for c in m.state['claims'].values()))
        self.run_plan(p,m,t);self.assertEqual(len(t.posts),1)
    def test_atomic_checkpoint_and_exclusive_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            path=os.path.join(directory,'checkpoint.json')
            resume.atomic_save(path,{'attempts':1,'deadline':100})
            with open(path) as file:self.assertEqual(json.load(file)['attempts'],1)
            self.assertEqual(os.stat(path).st_mode & 0o777,0o600)
            os.mkdir(path+'.lock')
            with self.assertRaises(FileExistsError):resume.cli(['--resume-plan','never-read','--plan-sha256','unused','--checkpoint',path],{},lane)
    def test_changed_plan_cannot_reset_spent_checkpoint(self):
        p=plan();m=Memory();t=Transport(m);self.run_plan(p,m,t,write=False)
        changed=copy.deepcopy(p);changed['deadline']=200
        with self.assertRaisesRegex(resume.Hold,'checkpoint_plan_changed'):self.run_plan(changed,m,t)
        self.assertEqual(m.state['deadline'],100);self.assertFalse(t.posts)
    def test_legacy_write_refuses_before_environment_or_model(self):
        asked=[];self.assertEqual(lane.run(['--write'],{},ask=lambda *a:asked.append(a),out=lambda x:None),2);self.assertFalse(asked)

if __name__=='__main__':unittest.main()
