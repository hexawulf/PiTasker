# PiTasker API Documentation

**Version**: 2.0.0  
**Base URL**: `http://localhost:5000`  
**Authentication**: Session-based (cookies)

---

## Table of Contents

1. [Authentication](#authentication)
2. [Task Management](#task-management)
3. [Crontab Integration](#crontab-integration)
4. [System & Health](#system--health)
5. [Error Handling](#error-handling)
6. [Examples](#examples)

---

## Authentication

### POST /login
Authenticate user and create session.

**Request Body**:
```json
{
  "username": "string",
  "password": "string"
}
```

**Response**: `200 OK`
```json
{
  "message": "Login successful.",
  "redirectTo": "/dashboard"
}
```

**Errors**:
- `400`: Missing username/password
- `401`: Invalid credentials

---

### GET /logout
End user session.

**Response**: `200 OK`
```json
{
  "message": "Logout successful.",
  "redirectTo": "/login"
}
```

---

### POST /change-password
Change user password (requires authentication).

**Request Body**:
```json
{
  "currentPassword": "string",
  "newPassword": "string",
  "confirmNewPassword": "string"
}
```

**Response**: `200 OK`
```json
{
  "message": "Password changed successfully."
}
```

**Errors**:
- `400`: Validation errors
- `401`: Incorrect current password

---

## Task Management

All endpoints require authentication.

### GET /api/tasks
List all tasks.

**Response**: `200 OK`
```json
[
  {
    "id": 1,
    "name": "Daily Backup",
    "cronSchedule": "0 2 * * *",
    "command": "/usr/bin/backup.sh",
    "status": "success",
    "lastRun": "2025-10-29T02:00:00Z",
    "output": "Backup completed",
    "createdAt": "2025-10-28T10:00:00Z",
    "crontabId": "550e8400-e29b-41d4-a716-446655440000",
    "syncedToCrontab": true,
    "crontabSyncedAt": "2025-10-29T02:00:05Z",
    "source": "pitasker",
    "isSystemManaged": true
  }
]
```

---

### GET /api/tasks/:id
Get single task by ID.

**Parameters**:
- `id` (path): Task ID

**Response**: `200 OK` (same structure as single task above)

**Errors**:
- `400`: Invalid task ID
- `404`: Task not found

---

### POST /api/tasks
Create new task.

**Request Body**:
```json
{
  "name": "string (1-100 chars)",
  "cronSchedule": "string (cron format)",
  "command": "string (1-500 chars)",
  "isSystemManaged": true  // optional, defaults to true
}
```

**Example**:
```json
{
  "name": "Temperature Monitor",
  "cronSchedule": "*/15 * * * *",
  "command": "vcgencmd measure_temp >> /var/log/temp.log",
  "isSystemManaged": true
}
```

**Response**: `201 Created`
```json
{
  "id": 2,
  "name": "Temperature Monitor",
  "cronSchedule": "*/15 * * * *",
  "command": "vcgencmd measure_temp >> /var/log/temp.log",
  "status": "pending",
  "lastRun": null,
  "output": null,
  "createdAt": "2025-10-29T10:30:00Z",
  "crontabId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "syncedToCrontab": true,
  "crontabSyncedAt": "2025-10-29T10:30:01Z",
  "source": "pitasker",
  "isSystemManaged": true
}
```

**Validation Rules**:
- `name`: 1-100 characters, required
- `cronSchedule`: Valid 5-field cron expression
- `command`: 1-500 characters, required
- `isSystemManaged`: boolean, optional (default: true)

**Errors**:
- `400`: Validation failed

---

### PATCH /api/tasks/:id
Update existing task (partial updates supported).

**Parameters**:
- `id` (path): Task ID

**Request Body** (all fields optional):
```json
{
  "name": "string",
  "cronSchedule": "string",
  "command": "string",
  "status": "pending|running|success|failed",
  "isSystemManaged": boolean
}
```

**Response**: `200 OK` (updated task object)

**Behavior**:
- If `isSystemManaged=true`: Updates synced to crontab
- If schedule/command changed: Crontab entry updated
- Reschedules node-cron task automatically

**Errors**:
- `400`: Invalid task ID or validation errors
- `404`: Task not found

---

### DELETE /api/tasks/:id
Delete task.

**Parameters**:
- `id` (path): Task ID

**Response**: `204 No Content`

**Behavior**:
- Removes from database
- Removes from system crontab (if has crontab_id)
- Unschedules node-cron task

**Errors**:
- `400`: Invalid task ID
- `404`: Task not found

---

### POST /api/tasks/:id/run
Execute task manually (immediate execution).

**Parameters**:
- `id` (path): Task ID

**Response**: `200 OK`
```json
{
  "message": "Task execution started"
}
```

**Behavior**:
- Runs task immediately via node-cron
- Updates task status to "running"
- Does NOT affect crontab schedule

**Errors**:
- `400`: Invalid task ID
- `404`: Task not found
- `409`: Task already running

---

### POST /api/tasks/:id/toggle-system-managed
Toggle system crontab management for task.

**Parameters**:
- `id` (path): Task ID

**Response**: `200 OK` (updated task object)

**Behavior**:
- **If enabling**: Adds task to system crontab
- **If disabling**: Removes from crontab, keeps in database
- Updates `isSystemManaged` and sync flags

**Errors**:
- `400`: Invalid task ID
- `404`: Task not found
- `500`: Crontab operation failed

---

### GET /api/tasks/stats
Get task statistics.

**Response**: `200 OK`
```json
{
  "totalTasks": 10,
  "runningTasks": 1,
  "successfulTasks": 7,
  "failedTasks": 2,
  "pendingTasks": 0
}
```

---

### GET /api/tasks/export
Export all tasks as JSON file.

**Query Parameters**:
- `pretty` (optional): `true` for formatted JSON

**Response**: `200 OK` (application/json)
```json
[
  {
    "id": 1,
    "name": "Task Name",
    "schedule": "0 2 * * *",
    "command": "/usr/bin/task.sh",
    "createdAt": "2025-10-29T00:00:00Z",
    "updatedAt": "2025-10-29T00:00:00Z"
  }
]
```

**Headers**:
```
Content-Type: application/json
Content-Disposition: attachment; filename="pitasker-tasks.json"
```

---

## Crontab Integration

All endpoints require authentication.

### POST /api/crontab/import
Import system crontab entries into database.

**Response**: `200 OK`
```json
{
  "imported": 3,
  "updated": 2,
  "skipped": 1,
  "errors": []
}
```

**Behavior**:
- Reads user's system crontab
- Imports new entries as tasks
- Updates existing PiTasker-managed entries
- Skips unchanged entries
- Preserves non-PiTasker entries

---

### POST /api/crontab/export
Export database tasks to system crontab.

**Request Body** (optional):
```json
{
  "taskIds": [1, 2, 3]  // Optional: specific tasks to export
}
```

**Response**: `200 OK`
```json
{
  "imported": 0,
  "updated": 0,
  "exported": 5,
  "failed": 0,
  "errors": []
}
```

**Behavior**:
- Exports all system-managed tasks (or specific tasks if IDs provided)
- Creates new crontab entries for unsynced tasks
- Updates existing crontab entries
- Updates sync timestamps in database

---

### POST /api/crontab/sync
Full bidirectional synchronization.

**Response**: `200 OK`
```json
{
  "imported": 1,
  "updated": 2,
  "exported": 3,
  "failed": 0,
  "errors": []
}
```

**Behavior**:
- Step 1: Import from crontab (get latest state)
- Step 2: Export to crontab (push database changes)
- Resolves conflicts (database is source of truth)

---

### GET /api/crontab/status
Get crontab sync status overview.

**Response**: `200 OK`
```json
{
  "lastSync": "2025-10-29T10:30:00Z",
  "dbTaskCount": 10,
  "crontabEntryCount": 8,
  "systemManagedCount": 8,
  "syncedCount": 8,
  "unsyncedCount": 0,
  "databaseOnlyCount": 2,
  "managedCrontabEntries": 8,
  "unmanagedCrontabEntries": 2
}
```

**Field Descriptions**:
- `lastSync`: Most recent sync timestamp
- `dbTaskCount`: Total tasks in database
- `crontabEntryCount`: Total crontab entries
- `systemManagedCount`: Tasks with isSystemManaged=true
- `syncedCount`: Tasks successfully synced
- `unsyncedCount`: Tasks needing sync
- `databaseOnlyCount`: Database-only tasks
- `managedCrontabEntries`: PiTasker-managed crontab entries
- `unmanagedCrontabEntries`: Non-PiTasker crontab entries

---

### GET /api/crontab/validate
Validate sync integrity between database and crontab.

**Response**: `200 OK`
```json
{
  "isValid": false,
  "discrepancies": [
    {
      "type": "missing_in_crontab",
      "taskId": 5,
      "crontabId": "550e8400-...",
      "details": "Task 'Daily Cleanup' has crontab ID but entry not found"
    },
    {
      "type": "schedule_mismatch",
      "taskId": 3,
      "crontabId": "7c9e6679-...",
      "details": "Schedule mismatch: DB has '0 2 * * *', crontab has '0 3 * * *'"
    }
  ]
}
```

**Discrepancy Types**:
- `missing_in_crontab`: Task marked as synced but entry not in crontab
- `missing_in_db`: Crontab entry managed by PiTasker but not in database
- `schedule_mismatch`: Schedule differs between database and crontab
- `command_mismatch`: Command differs between database and crontab

---

### GET /api/crontab/raw
Get raw crontab content.

**Response**: `200 OK`
```json
{
  "content": "# PITASKER_ID:550e8400-e29b-41d4-a716-446655440000\n# PITASKER_COMMENT:Daily Backup\n0 2 * * * /usr/bin/backup.sh\n\n# Manual entry (not managed by PiTasker)\n30 4 * * * /usr/local/bin/cleanup.sh"
}
```

---

### PUT /api/crontab/raw
Manual crontab editing (advanced - currently disabled for safety).

**Request Body**:
```json
{
  "content": "string"
}
```

**Response**: `501 Not Implemented`
```json
{
  "message": "Raw crontab editing not implemented for safety reasons",
  "suggestion": "Use import/export endpoints instead"
}
```

---

### DELETE /api/crontab/:taskId
Remove task from crontab only (keeps in database).

**Parameters**:
- `taskId` (path): Task ID

**Response**: `200 OK`
```json
{
  "message": "Task removed from crontab successfully"
}
```

**Behavior**:
- Removes entry from system crontab
- Keeps task in database
- Updates sync flags to false

**Errors**:
- `400`: Invalid task ID
- `404`: Task not found
- `500`: Not synced to crontab

---

### GET /api/crontab/check-access
Check if user has crontab permissions.

**Response**: `200 OK`
```json
{
  "hasAccess": true
}
```

**Use Case**: Pre-flight check before enabling crontab features

---

## System & Health

### GET /health
Application health check.

**Response**: `200 OK`
```json
{
  "status": "ok",
  "uptime": "123456ms",
  "timestamp": "2025-10-29T10:30:00.000Z",
  "nodeVersion": "v20.18.1",
  "memoryUsage": {
    "rss": "89MB",
    "heapUsed": "45MB",
    "heapTotal": "67MB"
  }
}
```

---

### GET /api/system-stats
System statistics (CPU, memory, temperature).

**Response**: `200 OK`
```json
{
  "uptime": "5 days, 3 hours, 25 min",
  "cpuUsage": 15.3,
  "memoryUsage": 42.7,
  "cpuTemperature": 45.2
}
```

**Note**: Temperature requires `sensors` command (lm-sensors package)

---

### POST /api/import-cronjobs
Import cronjobs from JSON file (legacy endpoint).

**Request Body**:
```json
[
  {
    "name": "string",
    "schedule": "string",
    "command": "string"
  }
]
```

**Response**: `200 OK`
```json
{
  "imported": 3,
  "failed": 1
}
```

**Note**: Use `/api/crontab/import` for importing from system crontab

---

## Error Handling

### Standard Error Response

```json
{
  "message": "Error description",
  "errors": [
    {
      "path": ["fieldName"],
      "message": "Specific error message"
    }
  ]
}
```

### HTTP Status Codes

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful GET, PATCH, POST (non-create) |
| 201 | Created | Successful POST (create) |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Validation errors, invalid input |
| 401 | Unauthorized | Not authenticated |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Task already running |
| 500 | Internal Server Error | Server-side errors |
| 501 | Not Implemented | Feature disabled/not available |

---

## Examples

### Example 1: Create and Sync Task

```bash
# Login
curl -X POST http://localhost:5000/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}' \
  -c cookies.txt

# Create system-managed task
curl -X POST http://localhost:5000/api/tasks \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "name": "Disk Cleanup",
    "cronSchedule": "0 3 * * *",
    "command": "find /tmp -type f -atime +7 -delete",
    "isSystemManaged": true
  }'

# Verify in crontab
crontab -l | grep "Disk Cleanup"
```

---

### Example 2: Import Existing Crontab

```bash
# Add test entry to crontab
(crontab -l; echo "30 2 * * * /usr/bin/backup.sh") | crontab -

# Import to PiTasker
curl -X POST http://localhost:5000/api/crontab/import \
  -b cookies.txt

# Check status
curl http://localhost:5000/api/crontab/status \
  -b cookies.txt
```

---

### Example 3: Toggle System Management

```bash
# Get task ID
TASK_ID=1

# Toggle system management off
curl -X POST http://localhost:5000/api/tasks/$TASK_ID/toggle-system-managed \
  -b cookies.txt

# Verify removed from crontab
crontab -l | grep -v "#" | head

# Toggle back on
curl -X POST http://localhost:5000/api/tasks/$TASK_ID/toggle-system-managed \
  -b cookies.txt

# Verify re-added to crontab
crontab -l | tail -3
```

---

### Example 4: Validate Sync

```bash
# Manually modify crontab (simulate external change)
crontab -e
# Change a PiTasker entry's schedule

# Validate sync
curl http://localhost:5000/api/crontab/validate \
  -b cookies.txt | jq

# Example output:
{
  "isValid": false,
  "discrepancies": [
    {
      "type": "schedule_mismatch",
      "taskId": 1,
      "details": "..."
    }
  ]
}

# Fix discrepancies with full sync
curl -X POST http://localhost:5000/api/crontab/sync \
  -b cookies.txt
```

---

### Example 5: Bulk Export

```bash
# Export all system-managed tasks to crontab
curl -X POST http://localhost:5000/api/crontab/export \
  -b cookies.txt

# Export specific tasks only
curl -X POST http://localhost:5000/api/crontab/export \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"taskIds": [1, 2, 3]}'
```

---

## Rate Limiting

Currently no rate limiting implemented. Consider implementing for production:
- Authentication endpoints: 5 requests/minute
- Task CRUD: 60 requests/minute
- Crontab sync: 10 requests/minute

---

## Webhooks & Notifications

Currently using Firebase Cloud Messaging for browser notifications. 

Future webhook support planned for:
- Task completion
- Sync failures
- System alerts

---

## Changelog

### Version 2.0.0 (2025-10-29)
- ✨ Added complete crontab integration
- ✨ Added 9 new crontab management endpoints
- ✨ Added system-managed flag to tasks
- ✨ Added bidirectional sync capabilities
- 🔧 Enhanced task creation/update/delete with auto-sync
- 📊 Added crontab sync status and validation endpoints

### Version 1.0.0
- Initial release
- Basic task CRUD operations
- Node-cron scheduling
- Firebase notifications

---

## Further Reading

- [README.md](./README.md) - Feature overview and quick start
- [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) - Upgrade guide
- [TESTING_GUIDE.md](./TESTING_GUIDE.md) - Testing procedures
- [INSTALLATION.md](./INSTALLATION.md) - Deployment guide

---

**Last Updated**: 2025-10-29  
**API Version**: 2.0.0  
**Maintained By**: PiTasker Development Team
