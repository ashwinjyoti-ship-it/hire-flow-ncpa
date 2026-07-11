# Data Integrity Audit: SBI Foundation Day Task Priority Issue

## Issue Summary

The task "Send file to accounts" for event **SBI Foundation Day** is marked as **high priority** on 2026-07-11, despite having a due date of 2026-07-02 (when the user states the actual event ends on 2026-08-01).

**Verdict**: The priority assignment logic is **correct**. The issue is **upstream data corruption** in the event's end date.

---

## Root Cause Analysis

### The Chain of Events

1. **Event Record** (events table)
   - Title: SBI Foundation Day
   - event_end_date: **2026-07-01** ← WRONG (should be 2026-08-01)
   - Status: confirmed

2. **Task Creation** (operations.ts, lines 719-767)
   - Function: `createFileToAccountsReminders()`
   - Trigger: Runs for all confirmed events where `event_end_date < today`
   - Logic: Creates "Send file to accounts" task with due date = `event_end_date + 1 day`
   - For SBI Foundation: due_date = 2026-07-01 + 1 = **2026-07-02**

3. **Priority Assignment** (operations.ts, line 760)
   ```typescript
   priority: dueDate < today ? "high" : "medium"
   ```
   - Calculation: 2026-07-02 < 2026-07-11 = true
   - Result: priority = **"high"** ✓ (Logic is correct)

### Why the Logic is Correct

The priority system works as designed:
- Tasks with due dates in the **past** are marked **high** (urgent, overdue)
- Tasks with due dates in the **future** are marked **medium** (planned)
- This prevents tasks from appearing as "high priority" unless they're actually due soon or overdue

### The Real Problem

The event's `event_end_date` field contains incorrect data:
- **Stored**: 2026-07-01
- **Actual**: 2026-08-01 (per user)
- **Difference**: 31 days (a full month)

This cascades into:
- Wrong task due date (2026-07-02 instead of 2026-08-02)
- Wrong priority classification (high instead of medium)
- Distorted task priority signal across the entire system

---

## Impact Assessment

### Affected Areas
1. **Reports Dashboard**: Task shows as high priority when it shouldn't
2. **Task Workflows**: Tasks are ordered by priority; false positives bury real urgent items
3. **Team Notifications**: Users see alerts for tasks that aren't actually overdue
4. **Data Quality**: Undermines trust in the priority system's reliability

### System Integrity
The **code is sound**. The problem is **data quality**, not logic. Three categories exist:

| Category | Example | Status |
|----------|---------|--------|
| **Code Logic** | Priority = past due? | ✓ Correct |
| **Data Input** | event_end_date | ✗ Wrong |
| **User Trust** | "High priority loses value" | ✓ Valid concern |

---

## Remediation

### Immediate Fix: Correct the Event Record

To fix the SBI Foundation Day event, the event's `event_end_date` must be corrected from `2026-07-01` to `2026-08-01`.

**SQL Fix** (if direct DB access available):
```sql
UPDATE events 
SET event_end_date = '2026-08-01'
WHERE title LIKE '%SBI%' AND event_end_date = '2026-07-01';
```

**UI Fix** (preferred):
1. Open event detail page for SBI Foundation Day
2. Click "Edit Event"
3. Step 1: Change "Operating Window — End Date" from 2026-07-01 to 2026-08-01
4. Save changes

**Result After Fix**:
- Task due date recalculated: 2026-08-01 + 1 = 2026-08-02 ✓
- Priority recalculated: 2026-08-02 < 2026-07-11? = false → medium ✓
- System signal restored

### Long-Term Prevention

1. **Data Entry Validation**
   - Event end date should not be before event start date (already handled in frontend)
   - Consider adding warning if event end date > 90 days after start (possible typo)

2. **Audit & Cleanup**
   - Query to find other events with potentially corrupted dates:
     ```sql
     SELECT id, title, event_start_date, event_end_date, 
            ABS(julianday(event_end_date) - julianday(event_start_date)) as duration_days
     FROM events
     WHERE event_start_date IS NOT NULL
       AND event_end_date IS NOT NULL
       AND (julianday(event_end_date) - julianday(event_start_date)) < -1
     ORDER BY duration_days ASC;
     ```
   - Check events where end < start (should not exist)
   - Review multi-month events for entry errors

3. **Testing**
   - Add test case for date corruption scenarios
   - Validate priority logic against known corrupted dates
   - QA checklist: verify task priority reflects actual due date before deployment

4. **Documentation**
   - Add note in event creation flow: "Operating window = full duration org is at NCPA"
   - Clarify distinction: "Operating Window" (overall) vs. "Schedule Details" (per-venue specifics)

---

## Verification Checklist

- [ ] event_end_date corrected from 2026-07-01 to 2026-08-01
- [ ] Audit existing events for date anomalies (query provided above)
- [ ] Task priority recalculated (should change from high → medium)
- [ ] Verify no other events have been created with similar date errors
- [ ] Update team documentation on event date entry
- [ ] Consider adding UI warning for end_date < start_date + 7 days

---

## Conclusion

**System is working as designed.** The issue is data quality, not code logic. The priority system correctly identified that the task's calculated due date has passed. By correcting the event's end date to the actual date (2026-08-01), the priority will correctly recalculate to medium priority.

This audit demonstrates why your concern is valid: "High priority due immediately loses its value if it is unnecessarily used." Maintaining data integrity is critical to keeping priority signals reliable.
