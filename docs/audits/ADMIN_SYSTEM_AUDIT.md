# Admin System Audit Report

**Generated:** December 2025  
**Status:** ⚠️ FUNCTIONAL BUT NEEDS IMPROVEMENTS  
**Scope:** Admin access control, RLS policies, frontend protection, security vulnerabilities

---

## EXECUTIVE SUMMARY

The admin system provides centralized access control for platform administration through:
- `admin_users` table for explicit admin allowlisting
- `admin_notifications` table for workflow management
- Frontend components for admin dashboards
- RLS policies for database-level protection

**Key Findings:**
- ✅ Core functionality is working
- ⚠️ Dual admin check system (admin_users + profiles) creates confusion
- ⚠️ Missing INSERT/UPDATE policies on admin_users table
- ⚠️ Inconsistent admin checks across frontend components
- ⚠️ No admin activity logging/audit trail
- ⚠️ Missing admin user management UI

---

## 1. ARCHITECTURE OVERVIEW

### 1.1 Database Schema

**Primary Tables:**

1. **`admin_users`** (Created: `20250921000001_admin_notification_system.sql`)
   ```sql
   - id (UUID, PK)
   - user_id (UUID, FK to auth.users, UNIQUE)
   - admin_level (TEXT: 'admin', 'super_admin', 'moderator')
   - permissions (TEXT[]: array of permission strings)
   - is_active (BOOLEAN)
   - created_at, updated_at (TIMESTAMP)
   ```

2. **`admin_notifications`** (Created: `20250921000001_admin_notification_system.sql`)
   ```sql
   - id (UUID, PK)
   - notification_type (TEXT: ownership_verification_pending, etc.)
   - ownership_verification_id, vehicle_verification_id (UUID, FK)
   - user_id, vehicle_id (UUID, FK)
   - title, message (TEXT)
   - priority (INTEGER: 1-5)
   - action_required (TEXT)
   - status (TEXT: pending, in_review, approved, rejected, dismissed)
   - reviewed_by_admin_id (UUID, FK)
   - admin_notes, admin_decision (TEXT)
   - metadata (JSONB)
   - created_at, updated_at, expires_at (TIMESTAMP)
   ```

### 1.2 Admin Check Mechanisms

**Two-Path System (Potential Confusion):**

1. **Primary Path:** `admin_users` table
   - Explicit allowlist
   - Used by `AdminNotificationService.isCurrentUserAdmin()`
   - Used by `AdminDashboard.tsx`

2. **Fallback Path:** `profiles.user_type` or `profiles.role`
   - Legacy system via `is_admin_or_moderator()` function
   - Used as fallback in `AdminNotificationService.isCurrentUserAdmin()`
   - Used in various RLS policies

**Function: `is_admin_or_moderator()`**
```sql
CREATE OR REPLACE FUNCTION public.is_admin_or_moderator()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        (p.user_type::text IN ('admin', 'moderator'))
        OR (p.role IN ('admin', 'moderator', 'superadmin'))
      )
  );
$$;
```

**Issue:** Dual system creates confusion about which is authoritative.

---

## 2. SECURITY ANALYSIS

### 2.1 Row Level Security (RLS) Policies

#### ✅ **admin_notifications** - SECURE

**Policies:**
```sql
-- SELECT: Only admins can view
CREATE POLICY "Admins can view all notifications" ON admin_notifications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid() AND au.is_active = true
    )
  );

-- UPDATE: Only admins can update
CREATE POLICY "Admins can update notifications" ON admin_notifications
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid() AND au.is_active = true
    )
  );
```

**Status:** ✅ Secure - Uses `admin_users` table check

#### ⚠️ **admin_users** - INCOMPLETE

**Current Policies:**
```sql
-- SELECT: Only admins can view admin users
CREATE POLICY "Admins can view admin users" ON admin_users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid() AND au.is_active = true
    )
  );
```

**Missing Policies:**
- ❌ No INSERT policy (only service role can insert)
- ❌ No UPDATE policy (only service role can update)
- ❌ No DELETE policy (only service role can delete)

**Issue:** Admins cannot manage other admins through the API. This is likely intentional for security, but means admin management must be done via service role or direct SQL.

**Recommendation:** 
- If admins should manage other admins: Add UPDATE policy with permission checks
- If only super_admins should manage admins: Add UPDATE policy checking `admin_level = 'super_admin'`
- If only service role should manage: Document this clearly

### 2.2 Frontend Access Control

#### ✅ **AdminDashboard.tsx** - SECURE

**Access Check:**
```typescript
const { data: adminData } = await supabase
  .from('admin_users')
  .select('*')
  .eq('user_id', user.id)
  .eq('is_active', true)
  .single();

if (!adminData) {
  alert('Access denied: Admin privileges required');
  navigate('/org/dashboard');
  return;
}
```

**Status:** ✅ Secure - Checks `admin_users` table before rendering

#### ✅ **AdminShell.tsx** - SECURE

**Access Check:**
```typescript
const { loading, isAdmin } = useAdminAccess();

React.useEffect(() => {
  if (loading) return;
  if (!isAdmin) {
    navigate('/org/dashboard', { replace: true });
  }
}, [isAdmin, loading, location.pathname, navigate]);
```

**Status:** ✅ Secure - Uses `useAdminAccess()` hook

#### ✅ **AdminMissionControl.tsx** - ✅ FIXED (Defense in Depth)

**Status:** ✅ **FIXED** - Added admin check at component level

**Note:** This page is also protected by `AdminShell` wrapper in routes, but component-level check provides defense in depth.

**Current Code:**
```typescript
const { loading: adminLoading, isAdmin } = useAdminAccess();

if (adminLoading) return <Loading />;
if (!isAdmin) {
  return <AccessDenied />;
}
```

**Status:** ✅ Secure - Both route-level (AdminShell) and component-level protection

### 2.3 Admin Service Functions

#### ✅ **AdminNotificationService.isCurrentUserAdmin()** - SECURE

**Implementation:**
```typescript
static async isCurrentUserAdmin(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  // Primary: explicit admin allowlist table
  const { data, error } = await supabase
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (!error && !!data?.id) return true;

  // Fallback: profile-based privilege check
  try {
    const { data: allowed, error: rpcErr } = await supabase.rpc('is_admin_or_moderator');
    if (!rpcErr && allowed === true) return true;
  } catch {
    // ignore
  }

  return false;
}
```

**Status:** ✅ Secure - Checks both paths, defaults to false

**Note:** Fallback to `is_admin_or_moderator()` is for backwards compatibility but creates confusion.

---

## 3. ADMIN FUNCTIONS & RPCs

### 3.1 Admin Approval Functions

#### ✅ **admin_approve_ownership_verification()** - SECURE

**Security Check:**
```sql
IF NOT EXISTS (
  SELECT 1 FROM admin_users 
  WHERE user_id = p_admin_user_id AND is_active = true 
  AND 'approve_ownership' = ANY(permissions)
) THEN
  RAISE EXCEPTION 'User does not have admin permissions for ownership approval';
END IF;
```

**Status:** ✅ Secure - Checks both admin status AND specific permission

#### ✅ **admin_reject_ownership_verification()** - SECURE

**Security Check:** Same as approve function

**Status:** ✅ Secure

### 3.2 Admin Dashboard Stats

#### ✅ **get_admin_dashboard_stats()** - ⚠️ NO ACCESS CHECK

**Issue:** Function has no admin check. Anyone can call it.

**Current Code:**
```sql
CREATE OR REPLACE FUNCTION get_admin_dashboard_stats()
RETURNS JSONB AS $$
-- No admin check!
SELECT jsonb_build_object(...)
$$;
```

**Risk:** MEDIUM - Leaks admin dashboard statistics

**Recommendation:** Add admin check:
```sql
CREATE OR REPLACE FUNCTION get_admin_dashboard_stats()
RETURNS JSONB AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- Check admin status
  SELECT EXISTS (
    SELECT 1 FROM admin_users
    WHERE user_id = auth.uid() AND is_active = true
  ) INTO v_is_admin;
  
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;
  
  -- Return stats
  RETURN jsonb_build_object(...);
END;
$$;
```

---

## 4. FRONTEND COMPONENTS AUDIT

### 4.1 Admin Pages

| Component | Route | Admin Check | Status |
|-----------|-------|-------------|--------|
| `AdminDashboard.tsx` | `/admin/dashboard` | ✅ Yes (component) | ✅ Secure |
| `AdminMissionControl.tsx` | `/admin/mission-control` | ✅ Yes (component + route) | ✅ Secure |
| `AdminVerifications.tsx` | `/admin/verifications` | ✅ Yes (route + profiles check) | ⚠️ Inconsistent |
| `AdminPendingVehicles.tsx` | `/admin/pending-vehicles` | ✅ Yes (route) | ✅ Secure |
| `AdminAnalytics.tsx` | `/admin/analytics` (via AdminDashboard) | ✅ Yes (route) | ✅ Secure |
| `AdminHome.tsx` | `/admin` | ✅ Yes (route) | ✅ Secure |

**Note:** All admin routes are wrapped by `<AdminShell />` in `routes/modules/admin/routes.tsx`, which provides route-level protection via `useAdminAccess()` hook.

### 4.2 Admin Components

| Component | Admin Check | Status |
|-----------|-------------|--------|
| `AdminShell.tsx` | ✅ Yes (uses `useAdminAccess`) | ✅ Secure |
| `AdminNotificationCenter.tsx` | ❓ Unknown | ⚠️ Needs Check |
| `OwnershipVerificationDashboard.tsx` | ❓ Unknown | ⚠️ Needs Check |

### 4.3 Admin Hooks

| Hook | Implementation | Status |
|------|----------------|--------|
| `useAdminAccess()` | ✅ Uses `AdminNotificationService.isCurrentUserAdmin()` | ✅ Secure |

---

## 5. ISSUES & VULNERABILITIES

### 5.1 Critical Issues

#### ✅ **FIXED: AdminMissionControl.tsx Access Control**

**Location:** `nuke_frontend/src/pages/AdminMissionControl.tsx`

**Status:** ✅ **FIXED** - Added component-level admin check

**Note:** This page was already protected by `AdminShell` route wrapper, but component-level check provides defense in depth.

**Fix Applied:**
```typescript
const { loading: adminLoading, isAdmin } = useAdminAccess();

if (adminLoading) return <Loading />;
if (!isAdmin) {
  return <AccessDenied />;
}
```

#### 🟡 **MEDIUM: Missing RPC Admin Checks**

**Functions Missing Admin Checks:**
- `get_admin_dashboard_stats()` - No admin verification
- Potentially others (needs full audit)

**Risk:** MEDIUM - Information disclosure

**Fix:** Add admin checks to all admin RPC functions

### 5.2 Medium Issues

#### 🟡 **Inconsistent Admin Check System**

**Issue:** Two parallel systems:
1. `admin_users` table (primary)
2. `profiles.user_type` / `profiles.role` (fallback)

**Impact:** 
- Confusion about which is authoritative
- Potential for inconsistent behavior
- Maintenance burden

**Recommendation:**
- Standardize on `admin_users` table
- Deprecate `is_admin_or_moderator()` function
- Update all RLS policies to use `admin_users` check
- Remove fallback in `AdminNotificationService.isCurrentUserAdmin()`

#### 🟡 **Missing Admin User Management**

**Issue:** No UI for:
- Adding new admins
- Removing admins
- Updating admin permissions
- Viewing admin list

**Current State:** Must use service role or direct SQL

**Recommendation:** Create admin user management UI (protected by super_admin check)

#### 🟡 **No Admin Activity Logging**

**Issue:** No audit trail for:
- Admin actions (approvals, rejections)
- Admin access to sensitive data
- Admin permission changes

**Recommendation:** 
- Add `admin_activity_log` table
- Log all admin actions
- Include: admin_id, action_type, target_id, details, timestamp

### 5.3 Low Issues

#### 🟢 **Missing Admin Users INSERT/UPDATE Policies**

**Issue:** `admin_users` table has no INSERT/UPDATE policies (only SELECT)

**Current State:** Only service role can modify

**Impact:** 
- Admins cannot manage other admins via API
- Must use service role or direct SQL

**Recommendation:** 
- If admins should manage: Add policies with permission checks
- If only super_admins: Add policies checking `admin_level = 'super_admin'`
- If only service role: Document clearly

#### 🟢 **Incomplete Admin Dashboard**

**Issue:** Several tabs are placeholders:
- "Todo" tab: "Admin task management coming soon"
- "Users" tab: "User management coming soon"

**Impact:** Low - Missing functionality, not a security issue

---

## 6. RECOMMENDATIONS

### 6.1 Immediate Actions (High Priority)

1. **Fix AdminMissionControl.tsx Access Control**
   - Add `useAdminAccess()` check
   - Redirect non-admins
   - Test thoroughly

2. **Add Admin Checks to All Admin RPC Functions**
   - Audit all admin RPCs
   - Add admin verification
   - Test access control

3. **Audit All Admin Pages**
   - Check each admin page for access control
   - Add missing checks
   - Document requirements

### 6.2 Short-Term Improvements (Medium Priority)

1. **Standardize Admin Check System**
   - Remove `is_admin_or_moderator()` fallback
   - Update all RLS policies to use `admin_users`
   - Update documentation

2. **Add Admin Activity Logging**
   - Create `admin_activity_log` table
   - Log all admin actions
   - Add UI for viewing logs

3. **Create Admin User Management UI**
   - Add admin list page
   - Add create/edit admin forms
   - Protect with super_admin check

### 6.3 Long-Term Enhancements (Low Priority)

1. **Complete Admin Dashboard**
   - Implement "Todo" tab
   - Implement "Users" tab
   - Add more admin tools

2. **Add Admin Permissions System**
   - Granular permissions (already in schema)
   - Permission-based UI rendering
   - Permission checks in functions

3. **Add Admin Notifications**
   - Real-time notifications for admins
   - Email notifications for critical actions
   - Notification preferences

---

## 7. TESTING CHECKLIST

### 7.1 Access Control Tests

- [ ] Non-admin user cannot access `/admin`
- [ ] Non-admin user cannot access `/admin/dashboard`
- [ ] Non-admin user cannot access `/admin/verifications`
- [ ] Non-admin user cannot call admin RPC functions
- [ ] Admin user can access all admin pages
- [ ] Admin user can call admin RPC functions

### 7.2 RLS Policy Tests

- [ ] Non-admin cannot SELECT from `admin_notifications`
- [ ] Non-admin cannot UPDATE `admin_notifications`
- [ ] Non-admin cannot SELECT from `admin_users`
- [ ] Admin can SELECT from `admin_notifications`
- [ ] Admin can UPDATE `admin_notifications`
- [ ] Admin can SELECT from `admin_users`

### 7.3 Function Security Tests

- [ ] `get_admin_dashboard_stats()` requires admin
- [ ] `admin_approve_ownership_verification()` requires admin + permission
- [ ] `admin_reject_ownership_verification()` requires admin + permission

---

## 8. CODE EXAMPLES

### 8.1 Secure Admin Page Pattern

```typescript
import { useAdminAccess } from '../hooks/useAdminAccess';

const AdminPage: React.FC = () => {
  const { loading, isAdmin } = useAdminAccess();
  const navigate = useNavigate();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!isAdmin) {
    navigate('/org/dashboard');
    return null;
  }

  // Admin-only content here
  return <div>Admin Content</div>;
};
```

### 8.2 Secure RPC Function Pattern

```sql
CREATE OR REPLACE FUNCTION admin_function()
RETURNS JSONB AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- Check admin status
  SELECT EXISTS (
    SELECT 1 FROM admin_users
    WHERE user_id = auth.uid() 
      AND is_active = true
  ) INTO v_is_admin;
  
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Access denied: Admin privileges required';
  END IF;
  
  -- Admin logic here
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 8.3 Secure RLS Policy Pattern

```sql
CREATE POLICY "Admins can access table" ON table_name
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE user_id = auth.uid() 
        AND is_active = true
    )
  );
```

---

## 9. SUMMARY

### ✅ What's Working

- Core admin system is functional
- `admin_users` table provides explicit allowlist
- Most admin pages have access control
- Admin service functions check permissions
- RLS policies protect `admin_notifications`

### ⚠️ What Needs Fixing

- **CRITICAL:** `AdminMissionControl.tsx` missing access control
- **MEDIUM:** Some RPC functions missing admin checks
- **MEDIUM:** Dual admin check system creates confusion
- **MEDIUM:** No admin activity logging
- **LOW:** Missing admin user management UI

### 📋 Priority Actions

1. ✅ **COMPLETED:** Fix `AdminMissionControl.tsx` access control
2. **Short-term:** Standardize on `admin_users` table (remove `is_admin_or_moderator()` fallback)
3. **Short-term:** Add admin activity logging
4. **Short-term:** Fix `AdminVerifications.tsx` to use `admin_users` instead of `profiles.user_type`
5. **Short-term:** Add admin check to `get_admin_dashboard_stats()` RPC function
6. **Long-term:** Create admin user management UI

---

**Audit Completed:** December 2025  
**Next Review:** After fixes are applied

