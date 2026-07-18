/**
 * AI Access Settings — where a user brings their own compute.
 *
 * Route: /settings/ai
 *
 * Nuke owns the harness; the caller owns the compute. The in-app agent
 * (`agent-chat`) resolves credentials per-user in funnel order — the user's Claude
 * subscription, then their own Anthropic API key, then the platform key metered
 * against their prepaid balance. This page is the only place that funnel can be
 * filled, so it is the page the agent points at when it has nothing to run on.
 *
 * The UI already existed and was effectively unreachable: AIProviderSettings was
 * mounted only inside /capsule, and it renders <ClaudeSubscriptionSettings /> itself
 * (AIProviderSettings.tsx:151) — so mounting BOTH here would draw the Connect Claude
 * card twice. Render the parent only.
 *
 * NOT to be confused with /settings/connected-agents, which issues OUTBOUND keys
 * for external agents writing into Nuke. Opposite direction.
 */

import React from 'react';
import AIProviderSettings from '../../components/settings/AIProviderSettings';

const AIAccessPage: React.FC = () => (
  <div style={{ maxWidth: '760px', margin: '0 auto', padding: '24px 12px' }}>
    <h1 style={{
      fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
      marginBottom: '4px',
    }}>
      AI Access
    </h1>
    <p style={{ fontSize: '9px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '16px' }}>
      The in-app agent runs on your compute, in this order: your Claude subscription first,
      then your own Anthropic API key, then Nuke&rsquo;s key billed against your prepaid balance.
      Connect either one below and the agent stops asking.
    </p>

    {/* Renders the Connect Claude card and the BYOK key form. */}
    <AIProviderSettings />
  </div>
);

export default AIAccessPage;
