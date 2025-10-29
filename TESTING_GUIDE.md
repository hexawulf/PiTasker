# PiTasker Crontab Integration - Testing Guide

## Overview
This guide provides comprehensive testing procedures for the PiTasker crontab integration feature.

---

## Prerequisites

### System Requirements
- PostgreSQL database running
- User has crontab permissions: `crontab -l` (should not error)
- PiTasker application running: `npm run dev` or `npm start`
- Browser with developer tools

### Test Environment Setup
```bash
# 1. Navigate to project
cd /home/zk/projects/pitasker

# 2. Ensure database is up to date
npm run db:push

# 3. Start the application
npm run dev

# 4. Access application
# Open browser: http://localhost:5000
```

---

## Phase 4.1: Test Scenario Execution

### Scenario 1: Create System-Managed Task ✓

**Objective**: Verify task creation with automatic crontab sync

**Steps**:
1. Navigate to Dashboard
2. In the "Add New Task" form:
   - Name: `Test Backup Task`
   - Cron Schedule: `0 2 * * *`
   - Command: `echo "Test backup" >> /tmp/pitasker-test.log`
   - Ensure "Sync to System Crontab" toggle is **ON** (blue)
3. Click "Create Task"

**Expected Results**:
- ✅ Success toast: "Task Created"
- ✅ Task appears in task list
- ✅ "Crontab Sync" column shows green "Synced" badge
- ✅ Source shows "PiTasker" badge

**Verification Commands**:
```bash
# Check database
psql -d pitasker -c "SELECT id, name, synced_to_crontab, is_system_managed, crontab_id FROM tasks WHERE name='Test Backup Task';"

# Check system crontab
crontab -l | grep "Test backup"

# Should see entry with PITASKER_ID comment
# Example: 0 2 * * * echo "Test backup" >> /tmp/pitasker-test.log
```

**Cleanup**:
```bash
# Delete task from UI or:
# crontab -e  # Remove the test entry manually if needed
```

---

### Scenario 2: Create Database-Only Task ✓

**Objective**: Verify task creation WITHOUT crontab sync

**Steps**:
1. In "Add New Task" form:
   - Name: `Test Database Only`
   - Cron Schedule: `*/5 * * * *`
   - Command: `echo "DB only" >> /tmp/pitasker-dbonly.log`
   - Toggle "Sync to System Crontab" to **OFF** (gray)
2. Verify alert shows "Task will only run when PiTasker application is running"
3. Click "Create Task"

**Expected Results**:
- ✅ Success toast: "Task Created"
- ✅ Task appears in task list
- ✅ "Crontab Sync" column shows gray "DB Only" badge
- ✅ Source shows "PiTasker" badge

**Verification Commands**:
```bash
# Check database
psql -d pitasker -c "SELECT id, name, synced_to_crontab, is_system_managed FROM tasks WHERE name='Test Database Only';"
# Should show: synced_to_crontab=false, is_system_managed=false

# Check crontab (should NOT be there)
crontab -l | grep "DB only"
# Should return nothing
```

---

### Scenario 3: Import from Existing Crontab ✓

**Objective**: Import existing crontab entries into PiTasker

**Setup**:
```bash
# Add test entry to crontab
(crontab -l 2>/dev/null; echo "30 3 * * * /usr/local/bin/cleanup-temp.sh") | crontab -
```

**Steps**:
1. Click "Import from Crontab" button (in task form or header)
2. Modal opens showing "Import from System Crontab"
3. Verify the entry `30 3 * * * /usr/local/bin/cleanup-temp.sh` is shown
4. Click "Import All"

**Expected Results**:
- ✅ Success toast: "Import Complete: X new tasks imported, Y updated, Z skipped"
- ✅ New task appears in task list with auto-generated name
- ✅ "Crontab Sync" column shows green "Synced" badge
- ✅ Source shows "Imported" badge (purple)

**Verification Commands**:
```bash
# Check database
psql -d pitasker -c "SELECT id, name, source, command FROM tasks WHERE command LIKE '%cleanup-temp%';"

# Verify crontab entry has PITASKER_ID
crontab -l | grep -A1 "PITASKER_ID"
```

**Cleanup**:
```bash
# Remove test entry
crontab -l | grep -v "cleanup-temp.sh" | crontab -
```

---

### Scenario 4: Toggle System Management ✓

**Objective**: Switch task between system-managed and database-only

**Steps**:
1. Create a task with system management ON
2. In task list, find the task
3. Click the purple Server icon button
4. Confirm in modal if prompted

**Expected Results**:
- ✅ Success toast: "System Management Toggled"
- ✅ Badge changes from "Synced" to "DB Only"
- ✅ Entry removed from system crontab

**Verification Commands**:
```bash
# Before toggle - check crontab
crontab -l | grep "task-name"

# After toggle - entry should be gone
crontab -l | grep "task-name"  # Should return nothing

# Check database flag
psql -d pitasker -c "SELECT name, is_system_managed FROM tasks WHERE name='task-name';"
```

**Re-enable Test**:
1. Click Server icon again
2. Verify badge changes to "Not Synced" then "Synced"
3. Verify entry re-appears in crontab

---

### Scenario 5: Update Task Schedule ✓

**Objective**: Verify crontab sync on task update

**Steps**:
1. Create a system-managed task with schedule `0 2 * * *`
2. Click Edit icon
3. Change schedule to `0 3 * * *`
4. Save changes

**Expected Results**:
- ✅ Success toast: "Task Updated"
- ✅ Crontab entry updated with new schedule
- ✅ "Crontab Sync" badge shows updated timestamp

**Verification Commands**:
```bash
# Check updated schedule in crontab
crontab -l | grep "task-name"
# Should show: 0 3 * * * command

# Check database sync timestamp
psql -d pitasker -c "SELECT name, cron_schedule, crontab_synced_at FROM tasks WHERE name='task-name';"
```

---

### Scenario 6: Delete Task ✓

**Objective**: Verify crontab entry removal on task deletion

**Steps**:
1. Create a system-managed task
2. Note the task name
3. Click Delete (trash icon)
4. Confirm deletion

**Expected Results**:
- ✅ Success toast: "Task Deleted"
- ✅ Task removed from list
- ✅ Entry removed from system crontab

**Verification Commands**:
```bash
# Check database (should be gone)
psql -d pitasker -c "SELECT * FROM tasks WHERE name='deleted-task-name';"

# Check crontab (should be gone)
crontab -l | grep "deleted-task-name"
```

---

### Scenario 7: Sync All to Crontab ✓

**Objective**: Bulk sync operation

**Setup**:
```bash
# Manually remove a PITASKER entry from crontab to simulate out-of-sync
crontab -l | grep -v "PITASKER_ID" | crontab -
```

**Steps**:
1. Click "Sync All to Crontab" button in task list header
2. Wait for operation to complete

**Expected Results**:
- ✅ Success toast: "Sync Complete: X tasks synced to crontab"
- ✅ All system-managed tasks show "Synced" badge
- ✅ All entries re-appear in crontab

**Verification Commands**:
```bash
# Count PITASKER entries in crontab
crontab -l | grep -c "PITASKER_ID"

# Count system-managed tasks in database
psql -d pitasker -c "SELECT COUNT(*) FROM tasks WHERE is_system_managed=true;"

# Numbers should match
```

---

### Scenario 8: Filter Tasks ✓

**Objective**: Test task filtering functionality

**Setup**: Have tasks in different states (system-managed, database-only, synced, not synced)

**Steps**:
1. Test each filter option:
   - **All Tasks**: Shows all tasks
   - **System Managed**: Shows only is_system_managed=true
   - **Database Only**: Shows only is_system_managed=false
   - **Not Synced**: Shows system-managed tasks without sync

**Expected Results**:
- ✅ Each filter shows correct subset
- ✅ Empty state message when no matches
- ✅ Count updates appropriately

---

### Scenario 9: Manual Task Execution ✓

**Objective**: Run task manually (not via crontab)

**Steps**:
1. Create a task with command: `echo "Manual test $(date)" >> /tmp/pitasker-manual.log`
2. Click the green Play icon
3. Wait a few seconds

**Expected Results**:
- ✅ Success toast: "Task execution started"
- ✅ Task status changes to "Running" then "Success" or "Failed"
- ✅ "Last Run" column updates
- ✅ Output file created (if command writes to file)

**Verification Commands**:
```bash
# Check output file
cat /tmp/pitasker-manual.log

# Check task status
psql -d pitasker -c "SELECT name, status, last_run FROM tasks WHERE name='task-name';"
```

---

### Scenario 10: Concurrent Modification Handling ✓

**Objective**: Test behavior when crontab is modified externally

**Steps**:
1. Create a system-managed task in PiTasker
2. In terminal, manually edit crontab: `crontab -e`
3. Modify the schedule of the PiTasker-managed entry
4. In PiTasker, click "Sync All to Crontab"

**Expected Results**:
- ✅ PiTasker overwrites manual changes (database is source of truth)
- ✅ Or: Import detects changes and updates database (depending on implementation)
- ✅ No data loss
- ✅ Sync status remains consistent

---

## Phase 4.2: Error Handling Tests

### Test 1: Invalid Cron Syntax

**Steps**:
1. Try to create task with invalid cron: `invalid cron syntax`
2. Submit form

**Expected Results**:
- ✅ Validation error displayed
- ✅ Form does not submit
- ✅ Error message: "Invalid cron expression"

---

### Test 2: No Crontab Permission

**Setup**:
```bash
# Remove crontab temporarily (CAREFUL!)
crontab -r  # Removes all crontab entries
```

**Steps**:
1. Try to create system-managed task
2. Try to import from crontab

**Expected Results**:
- ✅ Graceful error handling
- ✅ User-friendly error message
- ✅ Task still created in database (fallback to database-only)

**Restore**:
```bash
# Re-enable crontab access
crontab -e  # Opens editor, save empty file
```

---

### Test 3: Database Connection Loss

**Steps**:
1. Stop PostgreSQL: `sudo systemctl stop postgresql`
2. Try to perform operations in PiTasker

**Expected Results**:
- ✅ Error messages displayed
- ✅ Application doesn't crash
- ✅ After PostgreSQL restart, operations resume

**Restore**:
```bash
sudo systemctl start postgresql
```

---

### Test 4: Long Commands

**Steps**:
1. Create task with very long command (>500 characters)

**Expected Results**:
- ✅ Validation error if exceeds limit
- ✅ Or: Command is truncated/wrapped properly
- ✅ No database errors

---

## Phase 4.3: Edge Cases

### Edge Case 1: Special Characters in Command

**Test Commands**:
```bash
echo "Test with 'quotes' and \"double quotes\""
find /tmp -name "*.log" -exec rm {} \;
cat /etc/passwd | grep root > /tmp/output.txt
```

**Expected**: All commands handled correctly in crontab format

---

### Edge Case 2: Empty Crontab

**Steps**:
1. Remove all crontab entries: `crontab -r`
2. Click "Import from Crontab"

**Expected Results**:
- ✅ Modal shows: "No crontab entries found"
- ✅ No errors
- ✅ Import button disabled or shows appropriate message

---

### Edge Case 3: Many Tasks

**Steps**:
1. Create 50+ tasks
2. Click "Sync All"

**Expected Results**:
- ✅ All tasks sync successfully
- ✅ Performance is acceptable (<5 seconds)
- ✅ No memory leaks
- ✅ Crontab not corrupted

---

### Edge Case 4: Task Name with Special Characters

**Test Names**:
- `Task with "quotes"`
- `Task with $variables`
- `Task with & ampersand`

**Expected**: Names stored and displayed correctly

---

## Test Results Summary

### Test Execution Checklist

#### Core Functionality
- [ ] ✓ Create system-managed task
- [ ] ✓ Create database-only task
- [ ] ✓ Import from crontab
- [ ] ✓ Toggle system management
- [ ] ✓ Update task schedule
- [ ] ✓ Delete task
- [ ] ✓ Sync all to crontab
- [ ] ✓ Filter tasks
- [ ] ✓ Manual task execution
- [ ] ✓ Concurrent modification handling

#### Error Handling
- [ ] ✓ Invalid cron syntax
- [ ] ✓ No crontab permission
- [ ] ✓ Database connection loss
- [ ] ✓ Long commands

#### Edge Cases
- [ ] ✓ Special characters in command
- [ ] ✓ Empty crontab
- [ ] ✓ Many tasks (50+)
- [ ] ✓ Special characters in task name

#### UI/UX
- [ ] ✓ All badges display correctly
- [ ] ✓ Tooltips show on hover
- [ ] ✓ Filters work correctly
- [ ] ✓ Toast notifications appear
- [ ] ✓ Loading states shown
- [ ] ✓ Responsive design (mobile/tablet)

#### Performance
- [ ] ✓ Task list loads < 1 second
- [ ] ✓ Sync operations complete < 5 seconds
- [ ] ✓ No memory leaks during extended use
- [ ] ✓ Crontab read/write operations efficient

---

## Verification Script

Create this script for automated verification:

```bash
#!/bin/bash
# File: verify-crontab-integration.sh
# Automated verification of PiTasker crontab integration

echo "========================================="
echo "PiTasker Crontab Integration Verification"
echo "========================================="
echo ""

# Check 1: Database schema
echo "✓ Checking database schema..."
psql -d pitasker -c "\d tasks" | grep -q "crontab_id" && echo "  ✓ crontab_id column exists" || echo "  ✗ crontab_id column missing"
psql -d pitasker -c "\d tasks" | grep -q "synced_to_crontab" && echo "  ✓ synced_to_crontab column exists" || echo "  ✗ synced_to_crontab column missing"
psql -d pitasker -c "\d tasks" | grep -q "is_system_managed" && echo "  ✓ is_system_managed column exists" || echo "  ✗ is_system_managed column missing"
echo ""

# Check 2: Crontab access
echo "✓ Checking crontab access..."
crontab -l &>/dev/null && echo "  ✓ Crontab access confirmed" || echo "  ✗ No crontab access"
echo ""

# Check 3: Count tasks
echo "✓ Checking task counts..."
TOTAL_TASKS=$(psql -d pitasker -t -c "SELECT COUNT(*) FROM tasks;" | tr -d ' ')
SYSTEM_MANAGED=$(psql -d pitasker -t -c "SELECT COUNT(*) FROM tasks WHERE is_system_managed=true;" | tr -d ' ')
SYNCED=$(psql -d pitasker -t -c "SELECT COUNT(*) FROM tasks WHERE synced_to_crontab=true;" | tr -d ' ')
CRONTAB_ENTRIES=$(crontab -l 2>/dev/null | grep -c "PITASKER_ID")

echo "  Total tasks in database: $TOTAL_TASKS"
echo "  System-managed tasks: $SYSTEM_MANAGED"
echo "  Synced tasks: $SYNCED"
echo "  Crontab entries with PITASKER_ID: $CRONTAB_ENTRIES"
echo ""

# Check 4: Sync consistency
echo "✓ Checking sync consistency..."
if [ "$SYNCED" -eq "$CRONTAB_ENTRIES" ]; then
    echo "  ✓ Database and crontab are in sync ($SYNCED entries)"
else
    echo "  ⚠ Warning: Database has $SYNCED synced tasks but crontab has $CRONTAB_ENTRIES entries"
    echo "  Consider running 'Sync All' from the UI"
fi
echo ""

# Check 5: API endpoints
echo "✓ Checking API endpoints..."
curl -s http://localhost:5000/health &>/dev/null && echo "  ✓ Server is running" || echo "  ✗ Server not responding"
echo ""

echo "========================================="
echo "Verification complete!"
echo "========================================="
```

**Usage**:
```bash
chmod +x verify-crontab-integration.sh
./verify-crontab-integration.sh
```

---

## Troubleshooting Common Issues

### Issue 1: Tasks not syncing to crontab

**Symptoms**: Task created but not in crontab

**Possible Causes**:
- isSystemManaged is false
- Crontab write failed

**Solution**:
```bash
# Check task flags
psql -d pitasker -c "SELECT id, name, is_system_managed, synced_to_crontab FROM tasks WHERE name='task-name';"

# Try manual sync
curl -X POST -b cookies.txt http://localhost:5000/api/crontab/export
```

### Issue 2: Import shows no entries

**Symptoms**: Import modal says "No crontab entries found" but crontab has entries

**Possible Causes**:
- All entries are comments
- API endpoint issue

**Solution**:
```bash
# Check raw crontab
crontab -l

# Check API response
curl -b cookies.txt http://localhost:5000/api/crontab/raw
```

### Issue 3: Duplicate entries in crontab

**Symptoms**: Multiple identical entries in crontab

**Possible Causes**:
- Sync called multiple times
- Bug in add logic

**Solution**:
```bash
# Clean up duplicates manually
crontab -l > /tmp/crontab-backup.txt
# Edit to remove duplicates
crontab /tmp/crontab-fixed.txt

# Or use sync to fix
curl -X POST -b cookies.txt http://localhost:5000/api/crontab/sync
```

---

## Performance Benchmarks

Expected performance metrics:

| Operation | Expected Time | Maximum Acceptable |
|-----------|---------------|-------------------|
| Load task list (10 tasks) | < 500ms | < 1s |
| Create task | < 1s | < 2s |
| Sync single task | < 500ms | < 1s |
| Sync all (50 tasks) | < 3s | < 5s |
| Import from crontab | < 1s | < 2s |
| Delete task | < 500ms | < 1s |

---

## Security Checklist

- [ ] ✓ All API endpoints require authentication
- [ ] ✓ Cron commands validated (no command injection)
- [ ] ✓ File paths validated (no path traversal)
- [ ] ✓ Database queries use parameterized statements
- [ ] ✓ User input sanitized
- [ ] ✓ Crontab entries properly escaped
- [ ] ✓ No sensitive data in logs
- [ ] ✓ CSRF protection enabled

---

## Test Sign-Off

**Tested By**: _________________  
**Date**: _________________  
**Environment**: Development / Staging / Production  
**Result**: Pass / Fail / Partial  

**Notes**:
___________________________________________________________________
___________________________________________________________________
___________________________________________________________________

---

**Last Updated**: 2025-10-29  
**Version**: 1.0.0
