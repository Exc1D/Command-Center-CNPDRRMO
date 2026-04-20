# QA, Error Handling & Test Coverage Investigation Report

**Project:** Command-Center-CNPDRRMO
**Date:** Tue Apr 21 2026
**Auditors:** Edge Hunter, Silent Failure Hunter, Test Coverage Analyst

---

## Test Suite Status

```
Test Files  6 passed (6)
     Tests  83 passed | 3 skipped (86)
```

**Key Finding:** While all tests pass, several tests are explicitly marked as **documenting known bugs** (e.g., `BUGGY: After 2nd fails, 3rd is NEVER synced`). Passing tests that assert buggy behavior is a false negative.

---

## 🔴 Critical Issues (Likely to cause data loss or crashes)

### 1. Race Condition: Item 3 Never Synced After Item 2 Fails

**File:** `src/lib/api.ts` lines 78–102
**Severity:** Critical
**Category:** Logic / Data Integrity

**Root Cause:** The `syncPending()` function iterates through `pendingAdds`, `pendingUpdates`, and `pendingDeletes` sequentially within a single try block. When any item fails, the outer `catch (line 99)` catches the error and the **entire sync loop terminates** — remaining items are never processed.

```typescript
// api.ts lines 81–98
try {
  const pendingAdds = await db.hazards.where('syncStatus').equals('pending_add').toArray();
  for (const hazard of pendingAdds) {           // ← if #2 fails here...
    await axios.post('/api/hazards', hazard);     // ...#3 is never reached
    await db.hazards.update(hazard.id, { syncStatus: 'synced' });
  }
  // ... same pattern for pendingUpdates and pendingDeletes
} catch (e) {
  console.error("Error during background sync", e);  // ← error swallowed, remaining items lost
}
```

**Test Evidence:**
- `BUGGY: After 2nd fails, 3rd is NEVER synced` — test PASSES, confirming bug exists
- `FIXED: After 2nd fails, 3rd IS synced` — test FAILS on current code (expected fix not implemented)

**Affected Users:** Any user who creates/edits multiple hazards while offline, then comes online when a network hiccup causes one sync to fail — their other pending changes are silently lost.

**Suggested Fix:** Process items in individual try/catch blocks, continue on error, track failures for retry.

---

### 2. TypeError: `pendingUpdates/pendingDeletes is not iterable`

**File:** `src/lib/api.ts` lines 89, 95
**Severity:** Critical
**Category:** Logic / Data Integrity / Off-by-One

**Root Cause:** When `syncPending()` is called with no pending items of a certain type, the for-of loop over `pendingUpdates` (line 89) or `pendingDeletes` (line 95) throws `TypeError: X is not iterable`.

Test output confirms:
```
Error during background sync TypeError: pendingUpdates is not iterable
    at Object.syncPending (/home/exxeed/dev/projects/Command-Center-CNPDRRMO/src/lib/api.ts:89:28)
Error during background sync TypeError: pendingDeletes is not iterable
    at Object.syncPending (/home/exxeed/dev/projects/Command-Center-CNPDRRMO/src/lib/api.ts:95:28)
```

**Affected Users:** Users who trigger sync when no pending updates/deletes exist.

**Suggested Fix:** Wrap each array iteration in a null/undefined check, or ensure Dexie returns empty arrays consistently.

---

### 3. Silent Error Swallowing in `syncPending()`

**File:** `src/lib/api.ts` lines 99–101
**Severity:** Critical
**Category:** Silent Failure / Data Integrity

```typescript
} catch (e) {
  console.error("Error during background sync", e);
}
```

The error is logged to console but **no user notification**, no retry mechanism, no persistence of failed sync items. The user loses data with no feedback.

**Suggested Fix:** Add error state to store, show user-facing error banner, queue failed items for retry.

---

## 🟠 High Priority Issues (Bugs or missing validations)

### 4. Hardcoded PIN in Source Code

**File:** `src/components/Modals.tsx` line 273
**Severity:** High
**Category:** Security / Hardcoded Credentials

```typescript
const CORRECT_PIN = '1234';
```

This is visible in client-side JavaScript. Anyone who opens DevTools can read the PIN and gain map authorization or authorize record deletion. **In emergency management software, this is unacceptable.**

**Suggested Fix:** Server-side PIN validation via API call.

---

### 5. No Server-Side Input Validation

**File:** `server.ts` lines 166–178
**Severity:** High
**Category:** Input Validation

```typescript
app.post("/api/hazards", (req, res) => {
  try {
    const { id, type, severity, title, municipality, barangay, notes, geometry, dateAdded } = req.body;
    // No validation that geometry is valid GeoJSON
    // No validation that id is a valid UUID
    // No validation that type is one of the allowed disaster types
```

Malformed data can be persisted to the database, causing crashes or rendering issues later.

**Suggested Fix:** Add Joi/Zod schema validation before DB insertion.

---

### 6. SQL Injection Vector via Direct Parameter Interpolation

**File:** `server.ts` line 223
**Severity:** High
**Category:** Security / SQL Injection

```typescript
app.delete("/api/hazards/:id", (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM hazards WHERE id = ?').run(id);
```

While `?` binding is used, `id` comes directly from `req.params` without validation. If `id` is not a valid UUID, behavior may be unexpected.

**Suggested Fix:** Validate `id` matches UUID format before querying.

---

### 7. No Authentication/Authorization on API Endpoints

**File:** `server.ts` entire file
**Severity:** High
**Category:** Security / Auth Bypass

The API has no authentication middleware. Any client can read, create, modify, or delete any hazard record. Given this is **emergency management software**, unauthorized manipulation of hazard data could cost lives.

**Suggested Fix:** Implement session-based auth or API keys.

---

### 8. Unhandled Promise Rejection in `App.tsx` Online Handler

**File:** `src/App.tsx` lines 23–28
**Severity:** High
**Category:** Uncaught Promise Rejection

```typescript
const handleOnline = () => {
  HazardAPI.syncPending().then(async () => {   // ← .then() without .catch()
    const hazards = await HazardAPI.getAllHazards();
    setHazards(hazards);
  });
};
```

If `syncPending()` rejects, the rejection is unhandled (no `.catch()`).

**Suggested Fix:** Add `.catch(console.error)` or use `try/catch` in an async handler.

---

## 🟡 Medium Priority Issues (Code quality, edge cases)

### 9. Missing Null Checks for Geometry Properties

**Files:**
- `src/components/Sidebar.tsx` lines 258–273
- `src/components/AnalyticsPanel.tsx` lines 230–245

**Severity:** Medium
**Category:** Potential Crash

```typescript
if (h.geometry.type === 'Polygon' && h.geometry.coordinates?.[0]?.[0]) {
  const coords = h.geometry.coordinates[0][0];
  if (coords && typeof coords[1] === 'number' && typeof coords[0] === 'number') {
    flyTo([coords[1], coords[0]], 14);  // ← if coords[0][0] is valid but coords[1] undefined
  }
}
```

Edge case: A Point geometry with `coordinates: [null, null]` would pass some checks but fail at runtime.

**Suggested Fix:** Add explicit null checks and type guards.

---

### 10. Race Condition: Concurrent Online/Offline State Changes

**File:** `src/App.tsx` lines 23–28, `src/lib/api.ts` lines 77–79
**Severity:** Medium
**Category:** Race Condition

The online handler and `syncPending()` both check `navigator.onLine` but don't coordinate. Rapid offline→online→offline transitions could cause:
1. `syncPending()` starts while online
2. Network drops before completion
3. Partial sync with inconsistent state

**Suggested Fix:** Use a sync lock/mutex to prevent concurrent syncs.

---

### 11. No Error Boundary for React Components

**Files:** All React components
**Severity:** Medium
**Category:** Error Handling

A malformed hazard in `filteredHazards` could crash the entire `DangerMap` or `AnalyticsPanel` rendering. No `componentDidCatch` or error boundary exists.

**Suggested Fix:** Wrap critical components in error boundaries.

---

### 12. Empty State: `handleSave()` Returns Silently

**File:** `src/components/Modals.tsx` lines 45–66
**Severity:** Medium
**Category:** UX / Silent Failure

```typescript
const handleSave = async () => {
  if (!municipality || !barangay) return;  // ← no user feedback
  // ... saves silently without indicating why
```

Disabled button shows "Location Required" but if state somehow bypasses the disabled check, save fails silently.

**Suggested Fix:** Add explicit error message display before save attempt.

---

### 13. Hardcoded Magic Numbers

**Files:** Multiple
**Severity:** Low
**Category:** Code Quality

| Location | Value | Meaning |
|----------|-------|---------|
| `Modals.tsx:273` | `'1234'` | PIN code |
| `utils.ts:105` | `0.5` | Proximity threshold (km) |
| `Sidebar.tsx:261,266` | `14, 15` | Zoom levels |
| `Sidebar.tsx:124` | `[14.1167, 122.9500]` | Province center |

**Suggested Fix:** Extract to named constants with documentation.

---

## 🟢 Minor Issues (Cosmetic, deferred)

### 14. `loadBarangayGeoJSON()` Cache Has No TTL or Invalidation

**File:** `src/lib/utils.ts` lines 78–83
**Severity:** Low
**Category:** Potential Stale Data

```typescript
let barangayCache: BarangayGeoJSON | null = null;
export async function loadBarangayGeoJSON(): Promise<BarangayGeoJSON> {
  if (barangayCache) return barangayCache;  // ← lives forever once loaded
```

If the barangay GeoJSON file is updated on the server, clients running for days won't see updates.

**Suggested Fix:** Add cache TTL or version-based invalidation.

---

### 15. Missing Loading State in `DropTagModal` After Detection

**File:** `src/components/Modals.tsx` lines 106–111
**Severity:** Low
**Category:** UX

When `detectLocationFromGeometry` is running, municipality input shows "Detecting..." placeholder but barangay shows "Barangay" — inconsistent UX during loading state.

---

### 16. No Rate Limiting on API Endpoints

**File:** `server.ts`
**Severity:** Low
**Category:** Security / DoS

An attacker or buggy client could flood the API with requests. No middleware limits request frequency per IP.

---

### 17. No HTTPS Enforcement

**File:** `server.ts`
**Severity:** Low
**Category:** Security

The server listens on HTTP. Production deployments should enforce HTTPS to protect PIN codes and hazard data in transit.

---

---

## Silent Failure Audit

### 🔴 CRITICAL: Silent Failures That Hide Data Loss

#### S1. Empty Catch Block — Server Migration

**File:** `server.ts` lines 42–44
**Severity:** CRITICAL
**Category:** Silent Failure / Data Integrity

```typescript
} catch (e) {
  // Column already exists, ignore
}
```

**Problem:** This catch block swallows **ALL errors**, not just "column already exists." If the database is locked, disk is full, or schema is corrupted, it will be silently hidden. Migrations fail silently and the server appears to work but with an incomplete schema.

**Hidden Errors:** SQLite locked, disk full, permission denied, corrupted database, schema errors

**User Impact:** Server starts but with corrupted or incomplete schema. Data may be written to wrong tables or fail silently.

**Recommendation:**
```typescript
} catch (e) {
  if ((e as Error).message.includes('duplicate column')) {
    // Column already exists, expected — ignore
  } else {
    console.error(`Migration failed for ${mig.name}:`, e);
    throw e; // Re-throw unexpected errors
  }
}
```

---

#### S2. No Error Handling on Initial Load

**File:** `src/App.tsx` lines 16–20
**Severity:** CRITICAL
**Category:** Silent Failure

```typescript
const fetchHazards = async () => {
  const hazards = await HazardAPI.getAllHazards();  // ← No try/catch!
  setHazards(hazards);
};
fetchHazards();
```

**Problem:** If the initial fetch fails, the error is silently swallowed. User sees empty data with no indication whether loading failed, the server is down, or there are truly no hazards.

**Hidden Errors:** Network offline, server down, database errors, malformed JSON

**User Impact:** App loads with blank state. User doesn't know if it's an error or truly empty.

**Recommendation:**
```typescript
const fetchHazards = async () => {
  try {
    const hazards = await HazardAPI.getAllHazards();
    setHazards(hazards);
  } catch (error) {
    console.error('Failed to load initial hazards:', error);
    // Show user-facing toast: "Failed to load hazards. Please refresh."
  }
};
```

---

#### S3. Floating Promise — `handleOnline` (also listed as #8, repeated for emphasis)

**File:** `src/App.tsx` lines 24–27
**Severity:** CRITICAL
**Category:** Silent Failure / Unhandled Rejection

```typescript
const handleOnline = () => {
  HazardAPI.syncPending().then(async () => {  // ← .then() without .catch()!
    const hazards = await HazardAPI.getAllHazards();
    setHazards(hazards);
  });
};
```

**Problem:** If `syncPending()` or `getAllHazards()` rejects, the error is unhandled. User comes back online, sync fails silently, and they see stale data with no explanation.

**Hidden Errors:** Network timeouts, server 5xx, database errors, JSON parse failures

**User Impact:** Coming back online after being offline — sync may fail silently. User sees stale data with no indication anything went wrong.

**Recommendation:**
```typescript
const handleOnline = async () => {
  try {
    await HazardAPI.syncPending();
    const hazards = await HazardAPI.getAllHazards();
    setHazards(hazards);
  } catch (error) {
    console.error('Sync failed after coming online:', error);
    // Notify user: "Sync failed. Some changes may not be saved."
  }
};
```

---

### 🟠 HIGH: Silent Fallbacks That Mask Network Failures

#### S4. Silent Fallback to Local DB — api.ts

**File:** `src/lib/api.ts` lines 21–26
**Severity:** HIGH
**Category:** Silent Failure / Unjustified Fallback

```typescript
} catch (e) {
  console.warn("Failed to fetch from server, falling back to local DB.", e);
}
// Offline fallback
return await db.hazards.toArray();
```

**Problem:** When server fetch fails, code silently falls back to IndexedDB cache using `console.warn` — not appropriate for production errors. **No user notification**, no error ID, no indication they're viewing stale data.

**Hidden Errors:** Server 5xx, network timeouts, auth failures, rate limiting

**User Impact:** User thinks they're viewing current server data but it's hours-old local cache. They have no way to know the server is unreachable.

**Recommendation:**
```typescript
} catch (e) {
  console.warn('Server unreachable, falling back to local cache:', e);
  // Show toast: "Operating in offline mode. Data may not reflect recent changes."
}
```

---

#### S5. Same Silent Fallback Pattern — api.ts Throughout

**Files:** `src/lib/api.ts` lines 37–40, 51–54, 68–74
**Severity:** HIGH
**Category:** Silent Failure

Every API method uses `console.warn` and falls back silently. Users don't know when their changes are saved locally vs. actually synced to the server. This pattern repeats across all API methods.

**User Impact:** User saves a hazard, thinks it's on the server, but it's only in local IndexedDB. They won't know until they refresh and see stale data.

---

#### S6. No Error Handling in `pm:remove` Map Handler

**File:** `src/components/Map.tsx` lines 59–66
**Severity:** HIGH
**Category:** Silent Failure

```typescript
map.on('pm:remove', async (e) => {
  const hazardId = (e.layer as any).hazardId;
  if (hazardId) {
    await HazardAPI.deleteHazard(hazardId);  // ← No try/catch
    const hazards = await HazardAPI.getAllHazards();  // ← No try/catch
    useStore.getState().setHazards(hazards);
  }
});
```

**Hidden Errors:** Delete fails, refresh fails, store becomes inconsistent

**User Impact:** User deletes a hazard from the map, thinks it's gone, but the delete actually failed silently. No feedback given.

---

#### S7. No Error Handling in `pm:edit` Map Handler

**File:** `src/components/Map.tsx` lines 162–176
**Severity:** HIGH
**Category:** Silent Failure

Same pattern as S6 — edit operations have no error handling. User edits geometry on map, thinks it saved, but the update actually failed silently.

---

### 🟡 MEDIUM: Generic Errors, Catch-Only-Log, Missing Handlers

#### S8. Generic Server Error Messages

**File:** `server.ts` lines 161–163, 175–177, 215–217, 225–227
**Severity:** MEDIUM
**Category:** Poor Error Messages

```typescript
} catch (error) {
  res.status(500).json({ error: 'Failed to fetch hazards' });
}
```

**Problem:** "Failed to fetch hazards" could mean DB locked, DB corrupted, query syntax error, or disk full — all indistinguishable. No error ID for Sentry tracking, no structured logging.

**Recommendation:** Include error codes and log details server-side:
```typescript
} catch (error) {
  const errorId = generateErrorId();
  console.error(`[${errorId}] Failed to fetch hazards:`, error);
  res.status(500).json({ error: 'Failed to fetch hazards', errorId });
}
```

---

#### S9. Catch-Only-Log Pattern — Sidebar and AnalyticsPanel

**Files:** `src/components/Sidebar.tsx:74-76`, `src/components/AnalyticsPanel.tsx:246-248`
**Severity:** MEDIUM
**Category:** Catch-Only-Log

```typescript
} catch (e) {
  console.error(e);
  alert('Failed to generate PDF...');
}
```

**Problem:** Errors are logged but user only gets a primitive `alert()`. No error ID, no structured logging, no retry option.

---

#### S10. No Error Handling in Modal Save/Delete Handlers

**Files:**
- `src/components/Modals.tsx:45-66` (handleSave in DropTagModal)
- `src/components/Modals.tsx:317-325` (handleDelete in PinModal)
- `src/components/EditHazardModal.tsx:30-52` (handleSave)

**Severity:** MEDIUM
**Category:** Silent Failure

All these data-modifying operations have no try/catch. If save fails, UI state becomes inconsistent and user gets no feedback.

---

#### S11. Silent Failures in Utility Functions

**File:** `src/lib/utils.ts` lines 78–129
**Severity:** MEDIUM
**Category:** Silent Failure

```typescript
export async function loadBarangayGeoJSON(): Promise<BarangayGeoJSON> {
  if (barangayCache) return barangayCache;
  const response = await fetch('/baranggays.geojson');  // ← No error handling
  barangayCache = await response.json();  // ← Could fail silently
  return barangayCache;
}

export async function detectLocationFromGeometry(geometry: any): Promise<DetectedLocation | null> {
  if (centroid) return null;  // ← Silent return on failure
}
```

**Problem:** If geojson fails to load or detection fails, it returns `null` silently. User's location detection shows "Detecting..." forever or empty fields with no explanation.

---

---

## Test Coverage Analysis

### Overview

The test suite has **modest coverage** of core business logic (API layer, store, utilities) but contains a critical problem: **the tests at api.test.ts:232-267 document buggy behavior rather than correct behavior**. The `FIXED` test correctly identifies the race condition bug but fails on current code, while the `BUGGY` test passes and asserts the wrong behavior. This is a false negative.

Overall: adequate for utilities and store, good for API integration tests, **absent for UI components, server routes, and critical error paths**.

**1,588 lines of source code** have zero test coverage — including the highest-risk code paths (App.tsx, Map.tsx, Modals.tsx, server.ts).

---

### 🔴 Critical Test Gaps (Must Add)

#### T-1: `syncPending` Race Condition — BUGGY Test Documents Wrong Behavior

**File:** `src/lib/api.test.ts` lines 232–267
**Severity:** CRITICAL — false negative

```typescript
// This test PASSES but asserts WRONG behavior
it('BUGGY: After 2nd fails, 3rd is NEVER synced', async () => {
  // ... asserts item 3 is NOT synced when item 2 fails
  expect(mockHazardsTable.update).not.toHaveBeenCalledWith('3', { syncStatus: 'synced' });
});

// This test FAILS on current code but expects CORRECT behavior
it('FIXED: After 2nd fails, 3rd IS synced - FAILS on current code', async () => {
  // ... expects item 3 IS synced even when item 2 fails
});
```

**Problem:** The `BUGGY` test passes on current code, documenting broken behavior as "correct." The `FIXED` test correctly expects item 3 to be synced but fails. **This means the test suite reports success while the bug exists.**

**Fix:** Delete the `BUGGY` test. Convert the `FIXED` test to `it.skip` until the fix is applied, with a comment referencing the bug.

---

#### T-2: `handleOnline` — No Tests, Unhandled Promise Rejection

**File:** `src/App.tsx` lines 23–28 (zero tests for App.tsx)
**Severity:** CRITICAL — untested high-risk code path

No tests exist for `App.tsx` at all (116 lines, zero coverage). The `handleOnline` function has an unhandled promise rejection (documented in Silent Failure Audit S3).

**Test to add:**
```typescript
describe('handleOnline', () => {
  it('catches syncPending failure and does not crash', async () => {
    vi.spyOn(HazardAPI, 'syncPending').mockRejectedValue(new Error('Network error'));
    vi.spyOn(HazardAPI, 'getAllHazards').mockResolvedValue([]);
    const setHazards = vi.fn();
    // Render App and verify no unhandled rejection
  });

  it('refreshes hazards after successful sync', async () => {
    vi.spyOn(HazardAPI, 'syncPending').mockResolvedValue(undefined);
    vi.spyOn(HazardAPI, 'getAllHazards').mockResolvedValue([h1]);
    const setHazards = vi.fn();
    // Verify hazards are refreshed
  });
});
```

---

#### T-3: Map.tsx `pm:remove` and `pm:edit` — No Tests, No Error Handling

**File:** `src/components/Map.tsx` lines 59–66, 162–176 (zero tests for Map.tsx)
**Severity:** CRITICAL — untested high-risk code path

No tests exist for `Map.tsx` (214 lines, zero coverage). Both `pm:remove` and `pm:edit` handlers have no error handling (documented in Silent Failure Audit S6–S7).

**Tests to add:**
```typescript
describe('GeomanSetup pm:remove', () => {
  it('handles deleteHazard failure gracefully without crashing', async () => {
    vi.spyOn(HazardAPI, 'deleteHazard').mockRejectedValue(new Error('Server error'));
    vi.spyOn(HazardAPI, 'getAllHazards').mockResolvedValue([]);
    // Trigger pm:remove event
    // Verify no crash, error is logged
  });

  it('updates store after successful delete', async () => {
    vi.spyOn(HazardAPI, 'deleteHazard').mockResolvedValue(undefined);
    vi.spyOn(HazardAPI, 'getAllHazards').mockResolvedValue([h2, h3]);
    // Trigger pm:remove event
    // Verify setHazards called with updated list
  });
});

describe('GeomanSetup pm:edit', () => {
  it('handles updateHazard failure gracefully', async () => {
    // Similar pattern
  });
});
```

---

#### T-4: EditHazardModal `handleSave` — No Tests, No Error Handling

**File:** `src/components/EditHazardModal.tsx` lines 30–52 (zero tests)
**Severity:** CRITICAL

`handleSave` has no try/catch. If `updateHazard` fails, `isSaving` stays `true` forever, modal appears frozen.

**Test to add:**
```typescript
describe('EditHazardModal handleSave', () => {
  it('resets isSaving on failure and shows error', async () => {
    vi.spyOn(HazardAPI, 'updateHazard').mockRejectedValue(new Error('Server error'));
    // Render modal, fill form, click save
    // Verify isSaving becomes false even on failure
    // Verify error is shown to user
  });

  it('closes modal on successful save', async () => {
    vi.spyOn(HazardAPI, 'updateHazard').mockResolvedValue(undefined);
    // Verify modal closes after save
  });
});
```

---

#### T-5: PinModal `handleDelete` — No Tests, No Error Handling

**File:** `src/components/Modals.tsx` lines 317–325 (zero tests for Modals.tsx)
**Severity:** CRITICAL

`handleDelete` has no try/catch. If `deleteHazard` fails, modal closes anyway with no feedback.

**Test to add:**
```typescript
describe('PinModal handleDelete', () => {
  it('shows error when deleteHazard fails after correct PIN', async () => {
    vi.spyOn(HazardAPI, 'deleteHazard').mockRejectedValue(new Error('Server error'));
    // Enter correct PIN ('1234'), trigger delete
    // Verify error is shown, modal stays open
  });

  it('closes modal on successful delete', async () => {
    vi.spyOn(HazardAPI, 'deleteHazard').mockResolvedValue(undefined);
    // Enter correct PIN, verify modal closes
  });
});
```

---

### 🟡 Important Test Improvements (Should Add)

#### T-6: PIN Validation — No Tests, Hardcoded `'1234'`

**File:** `src/components/Modals.tsx:273`
**Severity:** IMPORTANT

The PIN is hardcoded as `const CORRECT_PIN = '1234'`. No tests verify PIN behavior (accept/reject, shake animation, clear after failure).

---

#### T-7: Sidebar PDF Export Error Path — Untested

**File:** `src/components/Sidebar.tsx:41-80`
**Severity:** MEDIUM

`handleExportPDF` has a try/catch but shows a primitive `alert()` on failure. No tests verify this behavior.

---

#### T-8: Municipality/Barangay Cascading Selection — Untested

**File:** `src/components/Sidebar.tsx:119-169`
**Severity:** MEDIUM

Cascading selection (reset barangay when municipality changes, flyTo on selection) has no tests.

---

#### T-9: db.ts Operations — Zero Tests

**File:** `src/lib/db.ts` (27 lines, zero tests)
**Severity:** MEDIUM

Database query patterns (`.where('syncStatus').equals()`) have no verification.

---

#### T-10: App.tsx Component — Zero Tests

**File:** `src/App.tsx` (116 lines, zero tests)
**Severity:** IMPORTANT

No tests for: initial hazard fetch on mount, online/offline event listener registration and cleanup, analytics toggle.

---

### 🟠 Test Quality Issues

#### TQ-1: `BUGGY` test asserts wrong behavior as passing

**File:** `src/lib/api.test.ts:232-248`
**Severity:** HIGH — false negative

The test named `BUGGY: After 2nd fails, 3rd is NEVER synced` **passes on current code** and **asserts incorrect behavior**. The companion `FIXED` test **fails on current code** but expects correct behavior. Tests should verify correct behavior, not document bugs.

**Recommendation:** Delete the `BUGGY` test. Mark `FIXED` as `it.skip` with comment referencing the bug.

---

#### TQ-2: Unit tests test implementation copies, not actual component behavior

**File:** `src/components/AnalyticsPanel.unit.test.tsx`
**Severity:** MEDIUM

Tests define local functions `filterHazardsForList` and `getTitleDisplay` that are copies of AnalyticsPanel.tsx implementation. This tests **implementation details** rather than what the component actually does. The integration tests do test actual rendering, but these unit tests provide no regression protection for the real component.

---

#### TQ-3: Three skipped tests in utils.test.ts

**File:** `src/lib/utils.test.ts:213-247`
**Severity:** LOW

Skipped tests for: cache behavior, `isMultiple` flag with multiple nearby barangays, 3+ barangays in range. All skipped due to fixture limitations.

---

### 🟢 Positive Observations

- **HazardAPI tests are comprehensive** — online/offline, success/failure, sync operations, mocking is thorough
- **Integration test exists** for the critical offline-first workflow (api.integration.test.ts)
- **Store tests are behavioral** — test state transitions rather than implementation
- **Utility tests have good edge cases** — null/undefined, boundary distances, geometry types
- **AnalyticsPanel integration tests are solid** — real rendering with mocked store, user interactions verified

---

### Untested Source Files

| File | Lines | Test Coverage |
|------|-------|--------------|
| `App.tsx` | 116 | None |
| `Modals.tsx` | 404 | None |
| `EditHazardModal.tsx` | 178 | None |
| `Map.tsx` | 214 | None |
| `Sidebar.tsx` | 316 | None |
| `server.ts` | 253 | None |
| `db.ts` | 27 | None |
| **Total** | **1,588** | **Zero coverage** |

---

### Test Coverage Summary

| Priority | Test Gap | File(s) | Rating |
|----------|----------|---------|--------|
| CRITICAL | `BUGGY` test documents wrong behavior | `api.test.ts` | 9/10 |
| CRITICAL | `handleOnline` unhandled rejection, no tests | `App.tsx` | 9/10 |
| CRITICAL | Map `pm:remove`/`pm:edit` no error handling, no tests | `Map.tsx` | 9/10 |
| CRITICAL | EditHazardModal handleSave no error handling | `EditHazardModal.tsx` | 8/10 |
| CRITICAL | PinModal handleDelete no error handling | `Modals.tsx` | 8/10 |
| IMPORTANT | PIN validation no tests | `Modals.tsx` | 7/10 |
| IMPORTANT | App component no tests | `App.tsx` | 7/10 |
| MEDIUM | Sidebar PDF export error path | `Sidebar.tsx` | 6/10 |
| MEDIUM | db.ts operations | `db.ts` | 6/10 |

---

## Recommended Immediate Actions

1. **Fix the sync race condition** — Items 3+ must be processed even if item 2 fails
2. **Add null checks in `syncPending()`** — Prevent TypeError on empty arrays
3. **Move PIN to server-side validation** — Security-critical for emergency app
4. **Add input validation on server** — Prevent malformed data from being persisted
5. **Add user-facing error notifications** — Silent failures cause data loss without user awareness
6. **Fix empty catch block in migrations** — only ignore "duplicate column", re-throw everything else
7. **Wrap `fetchHazards()` in try/catch** — surface initial load failures to user
8. **Replace `console.warn` fallbacks with user notifications** — users need to know they're in offline mode
9. **Add `.catch()` to `handleOnline`** — prevent silent failure on reconnection
10. **Add error handling to Map event handlers** — deletes/edits need to notify on failure
