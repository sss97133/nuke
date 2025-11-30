# Page Component Pattern

## ⚠️ IMPORTANT: Never Wrap Pages in AppLayout

AppLayout is **already provided globally** in `App.tsx` at the route level. Pages should **never** import or wrap themselves in `AppLayout`.

## ✅ Correct Pattern

```tsx
// ✅ CORRECT: Just return content directly
import React from 'react';
import '../design-system.css';

const MyPage: React.FC = () => {
  return (
    <div style={{ padding: 'var(--space-6)' }}>
      <h1>My Page Title</h1>
      {/* Your page content */}
    </div>
  );
};

export default MyPage;
```

## ❌ Wrong Pattern

```tsx
// ❌ WRONG: Don't wrap in AppLayout
import AppLayout from '../components/layout/AppLayout';

const MyPage: React.FC = () => {
  return (
    <AppLayout title="My Page">
      <div>Content</div>
    </AppLayout>
  );
};
```

## Examples

See these pages for correct patterns:
- `src/pages/About.tsx`
- `src/pages/PrivacyPolicy.tsx`
- `src/pages/TermsOfService.tsx`

## Double-Wrapping Detection

The system now detects and prevents double wrapping:
- **Development**: Throws error immediately
- **Production**: Logs warning but doesn't break

If you see a double-wrapping error, simply remove the `<AppLayout>` wrapper from your page component.

