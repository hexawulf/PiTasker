# PiTasker Migration Guide - Crontab Integration

## Overview
This guide helps existing PiTasker users migrate to version with system crontab integration.

**Migration Difficulty**: Low  
**Estimated Time**: 5-10 minutes  
**Downtime Required**: Yes (~2 minutes)  
**Data Loss Risk**: Minimal (with proper backups)

---

## What's New

### Version 2.0 - Crontab Integration

**New Features**:
- ✅ Bidirectional sync between PiTasker database and system crontab
- ✅ Import existing crontab entries into PiTasker
- ✅ Toggle between system-managed and database-only execution
- ✅ Visual sync status indicators
- ✅ Bulk sync operations
- ✅ Enhanced filtering capabilities

**Breaking Changes**: None - fully backward compatible!

**Database Changes**:
- 5 new columns added to `tasks` table
- Existing tasks default to system-managed mode
- No data migration required

---

## Pre-Migration Checklist

Before starting the migration, complete these checks:

### 1. Verify Requirements
```bash
# Check Node.js version (20.18.1+)
node --version

# Check PostgreSQL is running
psql -d pitasker -c "SELECT 1;"

# Check crontab access
crontab -l  # Should not error (can be empty)

# Check disk space (need ~100MB)
df -h /home/zk/projects/pitasker
```

### 2. Backup Current System
```bash
# Navigate to project
cd /home/zk/projects/pitasker

# Backup database
pg_dump pitasker > ~/backup-pitasker-$(date +%Y%m%d-%H%M%S).sql

# Backup current crontab
crontab -l > ~/backup-crontab-$(date +%Y%m%d-%H%M%S).txt

# Backup application files
tar -czf ~/backup-pitasker-app-$(date +%Y%m%d-%H%M%S).tar.gz .

# Verify backups exist
ls -lh ~/backup-pitasker* ~/backup-crontab*
```

### 3. Note Current State
```bash
# Count existing tasks
psql -d pitasker -c "SELECT COUNT(*) FROM tasks;"

# Note current crontab entries
crontab -l | wc -l

# Check PM2 status if using PM2
pm2 list
```

---

## Migration Steps

### Step 1: Stop the Application

```bash
# If using PM2
pm2 stop pitasker

# If using npm directly
# Press Ctrl+C in the terminal running the app

# If using systemd
sudo systemctl stop pitasker

# Verify stopped
curl http://localhost:5000/health  # Should fail
```

### Step 2: Update Code

```bash
cd /home/zk/projects/pitasker

# Fetch latest changes
git fetch origin main

# Stash any local changes (if any)
git stash

# Pull latest code
git pull origin main

# Reinstall dependencies (in case of updates)
npm install
```

### Step 3: Update Database Schema

```bash
# Method 1: Using drizzle-kit (Recommended)
npm run db:push

# Method 2: Manual SQL (if db:push has issues)
psql -d pitasker <<EOF
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS crontab_id TEXT UNIQUE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS synced_to_crontab BOOLEAN DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS crontab_synced_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'pitasker';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_system_managed BOOLEAN DEFAULT true;
EOF
```

**Verify Schema Update**:
```bash
# Check new columns exist
psql -d pitasker -c "\d tasks" | grep -E "(crontab_id|synced_to_crontab|is_system_managed)"
```

Expected output:
```
 crontab_id           | text                        |           |          | 
 synced_to_crontab    | boolean                     |           |          | false
 crontab_synced_at    | timestamp without time zone |           |          | 
 source               | text                        |           |          | 'pitasker'::text
 is_system_managed    | boolean                     |           |          | true
```

### Step 4: Build Application

```bash
# Run TypeScript type check
npm run check

# Build for production
npm run build

# Verify build artifacts
ls -lh dist/index.js dist/public/index.html
```

### Step 5: Start Application

```bash
# If using PM2
pm2 start ecosystem.config.cjs --env production
pm2 save

# If using npm
npm start

# If using systemd
sudo systemctl start pitasker

# Wait a few seconds then verify
curl http://localhost:5000/health
```

**Expected Response**:
```json
{
  "status": "ok",
  "uptime": "...",
  "timestamp": "...",
  ...
}
```

### Step 6: Initial Sync

You have two options for initial sync:

#### Option A: Sync Existing PiTasker Tasks to Crontab (Recommended)

```bash
# Via API (requires authentication cookie)
curl -X POST \
  -b cookies.txt \
  http://localhost:5000/api/crontab/export

# Via UI
# 1. Log in to PiTasker
# 2. Go to Dashboard
# 3. Click "Sync All to Crontab" button
# 4. Verify success toast
```

**Verify**:
```bash
# Count PiTasker entries in crontab
crontab -l | grep -c "PITASKER_ID"

# Should match number of tasks in database
psql -d pitasker -c "SELECT COUNT(*) FROM tasks WHERE is_system_managed=true;"
```

#### Option B: Import Existing Crontab Entries (If you have existing crontab)

```bash
# Via API
curl -X POST \
  -b cookies.txt \
  http://localhost:5000/api/crontab/import

# Via UI
# 1. Log in to PiTasker
# 2. Click "Import from Crontab" button
# 3. Review entries in modal
# 4. Click "Import All"
```

### Step 7: Verification

Run the automated verification script:

```bash
cd /home/zk/projects/pitasker
./verify-crontab-integration.sh
```

**Expected Output**:
```
=========================================
PiTasker Crontab Integration Verification
=========================================

Checking database schema...
  ✓ crontab_id column exists
  ✓ synced_to_crontab column exists
  ✓ is_system_managed column exists

Checking crontab access...
  ✓ Crontab access confirmed

Checking task counts...
  Total tasks in database: 5
  System-managed tasks: 5
  Synced tasks: 5
  Crontab entries with PITASKER_ID: 5

Checking sync consistency...
  ✓ Database and crontab are in sync (5 entries)

Checking API endpoints...
  ✓ Server is running

=========================================
Verification complete!
=========================================
```

### Step 8: Manual Verification (Optional)

```bash
# 1. View crontab
crontab -l

# Should see entries like:
# # PITASKER_ID:550e8400-e29b-41d4-a716-446655440000
# # PITASKER_COMMENT:Daily Backup
# 0 2 * * * /usr/bin/backup.sh

# 2. Check database sync status
psql -d pitasker -c "
SELECT 
  id, 
  name, 
  is_system_managed, 
  synced_to_crontab,
  crontab_id IS NOT NULL as has_crontab_id
FROM tasks
ORDER BY id;
"

# 3. Test in UI
# - Open browser to http://localhost:5000
# - Login
# - Verify all tasks show sync status badges
# - Try creating a new task
# - Verify it appears in crontab: crontab -l
```

---

## Post-Migration Tasks

### Update Your Workflow

**Old Workflow** (Pre-Migration):
1. Create task in PiTasker → Task runs via node-cron only
2. Tasks lost if PiTasker stops

**New Workflow** (Post-Migration):
1. Create task in PiTasker with "Sync to System Crontab" ON
2. Task automatically added to system crontab
3. Task runs even if PiTasker stops
4. Option to disable system sync for database-only tasks

### Test New Features

#### 1. Create System-Managed Task
```bash
# Via UI:
# 1. Fill in task form
# 2. Ensure toggle is ON (blue)
# 3. Create task
# 4. Verify: crontab -l | tail -3
```

#### 2. Toggle System Management
```bash
# Via UI:
# 1. Find any task in list
# 2. Click purple Server icon
# 3. Verify badge changes to "DB Only"
# 4. Check: crontab -l (entry should be gone)
# 5. Click Server icon again
# 6. Verify badge changes to "Synced"
# 7. Check: crontab -l (entry re-appears)
```

#### 3. Import Crontab Entries
```bash
# Add test entry
(crontab -l; echo "15 4 * * * /usr/local/bin/test.sh") | crontab -

# Import via UI:
# 1. Click "Import from Crontab"
# 2. Verify test entry is shown
# 3. Click "Import All"
# 4. Verify new task appears in list
```

#### 4. Filter Tasks
```bash
# Via UI:
# 1. Use filter dropdown
# 2. Test: All Tasks
# 3. Test: System Managed
# 4. Test: Database Only  
# 5. Test: Not Synced
```

### Update Monitoring

```bash
# Add crontab sync status to monitoring
curl -b cookies.txt http://localhost:5000/api/crontab/status

# Expected response:
{
  "lastSync": "2025-10-29T...",
  "dbTaskCount": 5,
  "crontabEntryCount": 5,
  "systemManagedCount": 5,
  "syncedCount": 5,
  "unsyncedCount": 0,
  ...
}
```

---

## Rollback Procedure

If you encounter issues and need to rollback:

### Step 1: Stop Application
```bash
pm2 stop pitasker
```

### Step 2: Restore Database
```bash
# Find your backup
ls -lh ~/backup-pitasker-*.sql

# Restore (replace YYYYMMDD-HHMMSS with your backup timestamp)
psql -d pitasker < ~/backup-pitasker-YYYYMMDD-HHMMSS.sql
```

### Step 3: Restore Crontab
```bash
# Restore original crontab
crontab ~/backup-crontab-YYYYMMDD-HHMMSS.txt

# Verify
crontab -l
```

### Step 4: Revert Code
```bash
cd /home/zk/projects/pitasker

# Find last stable commit
git log --oneline -10

# Revert to previous version (replace <commit-hash>)
git checkout <commit-hash>

# Rebuild
npm install
npm run build
```

### Step 5: Restart
```bash
pm2 start ecosystem.config.cjs --env production
```

---

## Troubleshooting

### Issue 1: Database Migration Fails

**Error**: `column "crontab_id" already exists`

**Solution**:
```bash
# This is OK - columns were already added
# Continue with migration
npm run build
pm2 restart pitasker
```

### Issue 2: Tasks Not Syncing to Crontab

**Symptoms**: Tasks created but not in crontab

**Solutions**:
```bash
# Check task flags
psql -d pitasker -c "SELECT id, name, is_system_managed, synced_to_crontab FROM tasks;"

# Manual sync
curl -X POST -b cookies.txt http://localhost:5000/api/crontab/export

# Check for errors
pm2 logs pitasker --lines 50
```

### Issue 3: Crontab Permission Denied

**Error**: `crontab: can't open your crontab file`

**Solution**:
```bash
# Check permissions
ls -l /var/spool/cron/crontabs/$(whoami)

# Fix permissions
sudo chmod u+rw /var/spool/cron/crontabs/$(whoami)

# Or create empty crontab
crontab -e  # Save empty file
```

### Issue 4: Import Shows No Entries

**Symptoms**: Import modal says "No entries found"

**Solution**:
```bash
# Check actual crontab
crontab -l

# Check API response
curl -b cookies.txt http://localhost:5000/api/crontab/raw

# If blank, add a test entry
echo "30 2 * * * echo test" | crontab -
```

### Issue 5: Build Fails

**Error**: TypeScript compilation errors

**Solution**:
```bash
# Clean and rebuild
rm -rf dist node_modules
npm install
npm run check
npm run build
```

---

## FAQ

### Q: Will my existing tasks still work?

**A**: Yes! All existing tasks will continue to work exactly as before. By default, they'll be marked as system-managed and will be synced to crontab on first export.

### Q: Do I need to change my existing tasks?

**A**: No. Existing tasks will work with default settings. You can optionally:
- Sync them to crontab: Click "Sync All to Crontab"
- Keep them database-only: Toggle "System Managed" off per task

### Q: What happens to my existing crontab?

**A**: PiTasker preserves all non-PiTasker crontab entries. Only entries with `# PITASKER_ID:` comments are managed by PiTasker.

### Q: Can I still use database-only tasks?

**A**: Yes! Toggle "Sync to System Crontab" OFF when creating tasks, or click the Server icon to disable system management.

### Q: What if I have duplicate entries?

**A**: Use the "Sync All" function to clean up:
```bash
# Option 1: Via UI - Click "Sync All to Crontab"
# Option 2: Via API
curl -X POST -b cookies.txt http://localhost:5000/api/crontab/sync
```

### Q: How do I undo a sync?

**A**: Toggle system management off for the task:
1. Find task in list
2. Click purple Server icon
3. Entry is removed from crontab
4. Task becomes database-only

### Q: Can I edit crontab manually?

**A**: Yes, but changes may be overwritten. Best practices:
- Edit tasks via PiTasker UI
- Or: Add non-PiTasker entries manually (without PITASKER_ID comments)
- Run "Sync All" if PiTasker overwrites manual changes

---

## Performance Impact

Migration impact on system resources:

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| RAM Usage | ~85MB | ~90MB | +5MB |
| Disk Space | ~50MB | ~55MB | +5MB |
| CPU Usage | <5% | <5% | No change |
| Startup Time | ~2s | ~2.5s | +0.5s |

---

## Success Criteria

Migration is successful when:
- ✅ Application starts without errors
- ✅ All existing tasks are visible in UI
- ✅ Verification script passes all checks
- ✅ New tasks can be created
- ✅ Tasks sync to crontab correctly
- ✅ `crontab -l` shows PITASKER_ID comments
- ✅ Import function works
- ✅ No database errors in logs

---

## Support

If you encounter issues:

1. Check logs: `pm2 logs pitasker --lines 100`
2. Run verification: `./verify-crontab-integration.sh`
3. Review [TESTING_GUIDE.md](./TESTING_GUIDE.md)
4. Check [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
5. Create issue on GitHub with:
   - Error message
   - Log output
   - Verification script results

---

## Additional Resources

- [README.md](./README.md) - Feature overview
- [INSTALLATION.md](./INSTALLATION.md) - Fresh installation guide
- [TESTING_GUIDE.md](./TESTING_GUIDE.md) - Testing procedures
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) - API reference

---

**Last Updated**: 2025-10-29  
**Migration Guide Version**: 1.0.0  
**Target PiTasker Version**: 2.0.0+
