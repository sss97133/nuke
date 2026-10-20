// Signed-in activity (header indicator) fixtures in the live readers' shapes: my_signature_queue, my_contact_requests,
// get_unread_notification_count and user_notifications rows (own-row policy). Synthetic ids, no real names or contacts.
import { WO } from './fixtures.mjs';

const AS_OF = '2026-10-19T19:00:00Z';
export const activityQueue = { as_of: AS_OF, coverage: { returned: 3, total: 3 }, items: [
  { kind: 'offer_to_accept', ref_id: 'o1', work_order_id: WO, display_title: 'E2E exhaust job', clock: { offered_at: AS_OF }, summary: {},
    sign: { rpc: 'accept_offer', binds: ['this provider'], does_not_bind: ['payment'] } },
  { kind: 'completion_to_accept', ref_id: 'comp1', work_order_id: WO, display_title: 'E2E exhaust job', clock: { attested_at: AS_OF }, summary: {},
    sign: { rpc: 'accept_work_completion', binds: ['acceptance'], does_not_bind: ['payment'] } },
  { kind: 'work_session', ref_id: 'ws1', work_order_id: null, vehicle_label: { text: '1983 GMC K2500' }, sign: { binds: ['self-confirmation'] } },
] };
export const activityContacts = { as_of: AS_OF, outgoing: [], incoming: [
  { request_id: 'req-c1', direction: 'incoming', status: 'pending', counterpart: { kind: 'user', handle: 'e2etech' }, context: { kind: 'work_order', id: WO, label: 'E2E exhaust job' },
    message: 'Can I see the car Thursday?', created_at: AS_OF, thread: { messages: 0, last_message_at: null }, actions: ['respond_contact_request'] },
] };
export const activityNotes = [
  { id: 'n-1', title: 'Your quote was accepted', message: 'E2E exhaust job', action_url: `/jobs/${WO}`, created_at: AS_OF, is_read: false },
];
export const activityReaders = (extra = {}) => ({
  my_signature_queue: activityQueue, my_contact_requests: activityContacts, get_unread_notification_count: 1,
  my_work_orders: { as_of: AS_OF, rows: [], next_after: null, coverage: { returned: 0, total_for_viewer: 0 } }, ...extra,
});
