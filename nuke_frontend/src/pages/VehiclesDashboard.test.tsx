// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import VehiclesDashboard from './VehiclesDashboard';
const fixture=vi.hoisted(()=>({loading:true,user:{id:'viewer-a'},dashboard:{vehicles:[],signedIn:true}}));
vi.mock('../hooks/useAuth',()=>({useAuth:()=>fixture}));
vi.mock('../hooks/usePageTitle',()=>({usePageTitle:vi.fn()}));
vi.mock('../hooks/useVehiclesDashboard',()=>({useVehiclesDashboard:()=>fixture.dashboard}));
vi.mock('../components/garage/GarageTab',()=>({default:({dashboard}:any)=><div>{dashboard===fixture.dashboard?'Canonical garage':'Wrong dashboard'}</div>}));
it('withholds garage during access resolution and uses the canonical owner afterward',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.createElement('div'),root=createRoot(host);
 try { await act(async()=>root.render(<VehiclesDashboard/>));expect(host.textContent).toContain('Checking access');expect(host.textContent).not.toContain('Canonical garage');
 fixture.loading=false;await act(async()=>root.render(<VehiclesDashboard/>));expect(host.textContent).toBe('Canonical garage');
 } finally {await act(async()=>root.unmount());}
});
