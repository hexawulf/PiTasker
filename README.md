# 🍓 PiTasker - Raspberry Pi Task Scheduler & Automation Dashboard

A lightweight, memory-optimized task scheduler and automation dashboard designed specifically for Raspberry Pi systems. Built with modern web technologies and optimized for <90MB memory usage.

![PiTasker Dashboard](https://img.shields.io/badge/Platform-Raspberry%20Pi-red?style=for-the-badge&logo=raspberry-pi)
![Node.js](https://img.shields.io/badge/Node.js-20.18.1-green?style=for-the-badge&logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=for-the-badge&logo=typescript)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue?style=for-the-badge&logo=postgresql)

## ✨ Features

### Core Features
- **🕒 Cron-based Task Scheduling** - Schedule tasks using standard cron syntax with real-time validation
- **⚡ Manual Task Execution** - Run tasks on-demand with confirmation dialogs
- **📊 Real-time Monitoring** - Live dashboard with task statistics and system memory tracking
- **🔔 Smart Notifications** - Firebase-powered browser notifications for task completion
- **💾 Memory Optimized** - Designed for <90MB RAM usage, perfect for Raspberry Pi
- **🎨 Modern UI** - Responsive design with dark/light mode using shadcn/ui components
- **📈 System Monitoring** - Built-in memory usage monitoring and performance tracking
- **🔄 Auto-restart** - Task scheduler with automatic recovery and health checks

### 🆕 System Crontab Integration
- **🔗 Bidirectional Sync** - Seamlessly sync tasks between PiTasker and system crontab
- **📥 Import Existing Crontab** - Import your existing crontab entries with one click
- **🔄 Real-time Sync Status** - Visual indicators showing sync state for each task
- **⚙️ Flexible Management** - Toggle between system crontab and database-only execution
- **🎯 Smart Filtering** - Filter tasks by sync status (All/System Managed/Database Only/Not Synced)
- **🔐 Safe Operations** - Preserves non-PiTasker crontab entries automatically
- **📊 Sync Dashboard** - Monitor crontab sync health with visual badges and tooltips
- **🔒 UUID Tracking** - Reliable task tracking using unique identifiers in crontab comments

## 🏗️ Tech Stack

**Frontend:**
- React 18 with TypeScript
- Vite build system
- Tailwind CSS + shadcn/ui components
- TanStack Query for state management
- Wouter for client-side routing

**Backend:**
- Node.js 20+ with Express.js
- PostgreSQL with Drizzle ORM
- node-cron for task scheduling
- Firebase Cloud Messaging
- Memory optimization middleware

**Infrastructure:**
- PostgreSQL database
- PM2 process management
- NGINX reverse proxy
- Systemd service integration

## 🚀 Quick Start

### Prerequisites

- Node.js 20.18.1 or higher
- PostgreSQL 15+
- Firebase project with Cloud Messaging enabled
- **User crontab access** - Verify with `crontab -l` (required for crontab integration)

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/pitasker.git
   cd pitasker
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your database and Firebase credentials
   ```

4. **Initialize database**
   ```bash
   npm run db:push
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

6. **Open browser**
   Navigate to `http://localhost:5000`

## 📱 Screenshots

### Dashboard Overview
The main dashboard shows task statistics, system monitoring, and active task management.

### Task Creation
Simple form interface for creating new scheduled tasks with cron validation.

### System Monitor
Real-time memory usage tracking optimized for Raspberry Pi constraints.

## 🔧 Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/pitasker

# Firebase Configuration
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_PROJECT_ID=your_firebase_project_id
VITE_FIREBASE_APP_ID=your_firebase_app_id

# Development
NODE_ENV=production
PORT=5000
```

### Database Schema

The application uses two main tables:
- `users` - User authentication (basic setup)
- `tasks` - Task definitions with scheduling information and crontab sync metadata

**Tasks Table Fields**:
- `id` - Primary key
- `name` - Task display name
- `cron_schedule` - Cron expression (5 fields)
- `command` - Shell command to execute
- `status` - Execution status (pending/running/success/failed)
- `last_run` - Last execution timestamp
- `output` - Last execution output
- `created_at` - Creation timestamp
- **`crontab_id`** - UUID linking to system crontab entry
- **`synced_to_crontab`** - Sync status flag
- **`crontab_synced_at`** - Last sync timestamp
- **`source`** - Origin (pitasker/crontab/imported)
- **`is_system_managed`** - System crontab management flag

## 📋 API Endpoints

### Task Management
- `GET /api/tasks` - List all tasks
- `POST /api/tasks` - Create new task (auto-syncs to crontab if system-managed)
- `PATCH /api/tasks/:id` - Update task (syncs changes to crontab)
- `DELETE /api/tasks/:id` - Delete task (removes from crontab)
- `POST /api/tasks/:id/run` - Manual task execution
- `POST /api/tasks/:id/toggle-system-managed` - Toggle system crontab management
- `GET /api/tasks/stats` - Task statistics
- `GET /api/tasks/export` - Export all tasks as JSON

### Crontab Integration (New!)
- `POST /api/crontab/import` - Import crontab entries to database
- `POST /api/crontab/export` - Export database tasks to crontab
- `POST /api/crontab/sync` - Full bidirectional sync
- `GET /api/crontab/status` - Get sync status overview
- `GET /api/crontab/validate` - Validate sync integrity
- `GET /api/crontab/raw` - Get raw crontab content
- `DELETE /api/crontab/:taskId` - Remove task from crontab only
- `GET /api/crontab/check-access` - Check crontab permissions

### System
- `GET /health` - Health check with memory usage
- `GET /api/memory` - Detailed memory monitoring
- `GET /api/system-stats` - CPU, memory, temperature

## 🔄 Using Crontab Integration

### Creating System-Managed Tasks

1. **Navigate to Dashboard** and locate the "Add New Task" form
2. Fill in task details:
   - **Name**: Descriptive name for your task
   - **Cron Schedule**: Use standard 5-field cron syntax (minute hour day month weekday)
   - **Command**: Shell command to execute
3. **Toggle "Sync to System Crontab"** (enabled by default):
   - **ON (Blue)**: Task runs via system crontab (continues even if PiTasker stops)
   - **OFF (Gray)**: Task runs via PiTasker only (database-only mode)
4. Click **"Create Task"**

The task will automatically be added to your system crontab with a unique tracking ID.

### Importing Existing Crontab

1. Click **"Import from Crontab"** button
2. Review detected crontab entries in the modal
3. Select entries to import (or use "Select All")
4. Click **"Import All"**

Your existing crontab entries will be imported as PiTasker tasks and will be marked as "Imported".

### Managing Sync Status

**Visual Indicators**:
- 🟢 **Green "Synced"** - Task is synchronized with system crontab
- 🟡 **Yellow "Not Synced"** - Task needs synchronization
- ⚪ **Gray "DB Only"** - Task runs via PiTasker only

**Bulk Operations**:
- **"Sync All to Crontab"** - Sync all system-managed tasks at once
- **Filter dropdown** - View tasks by sync status

**Per-Task Actions**:
- **Server Icon** - Toggle system management on/off
- **Edit** - Update task (changes auto-sync to crontab)
- **Delete** - Remove task (also removes from crontab)

### Verification

Check your system crontab at any time:
```bash
# View all crontab entries
crontab -l

# View only PiTasker-managed entries
crontab -l | grep PITASKER_ID
```

PiTasker uses special comment markers (`# PITASKER_ID:<uuid>`) to track managed entries.

---

## 🔄 Task Examples

### Basic Cron Schedules
```bash
# Run every minute
*/1 * * * *

# Run daily at 6 AM
0 6 * * *

# Run weekly on Sundays at midnight
0 0 * * 0

# Run monthly on the 1st at 3 AM
0 3 1 * *

# Run every 15 minutes
*/15 * * * *

# Run hourly at minute 30
30 * * * *
```

### Common Raspberry Pi Tasks
```bash
# System backup
tar -czf /backup/pi-backup-$(date +%Y%m%d).tar.gz /home/pi

# Temperature monitoring
vcgencmd measure_temp >> /var/log/pi-temp.log

# Disk cleanup (delete old temp files)
find /tmp -type f -atime +7 -delete

# Update DuckDNS (dynamic DNS)
curl "https://www.duckdns.org/update?domains=yourdomain&token=yourtoken"

# Check internet connectivity
ping -c 1 8.8.8.8 || echo "$(date): No internet" >> /var/log/connectivity.log

# Rotate logs
find /var/log/pitasker -name "*.log" -mtime +30 -delete
```

## 📊 Memory Optimization

PiTasker is specifically optimized for Raspberry Pi memory constraints:

- Target: <90MB RSS memory usage
- Built-in memory monitoring and warnings
- Garbage collection optimization
- Efficient PostgreSQL connection pooling
- Minimal dependency footprint

## 🛠️ Deployment

For production deployment on Raspberry Pi, see the following guides:
- **[INSTALLATION.md](./INSTALLATION.md)** - Complete installation and deployment guide
- **[MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)** - Upgrade guide for existing installations
- **[TESTING_GUIDE.md](./TESTING_GUIDE.md)** - Comprehensive testing procedures
- **[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)** - Detailed API reference

### Quick Production Setup

```bash
# Build the application
npm run build

# Start with PM2
pm2 start ecosystem.config.cjs --env production
pm2 save

# Verify crontab integration
./verify-crontab-integration.sh
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Built with [Replit](https://replit.com) rapid development platform
- UI components from [shadcn/ui](https://ui.shadcn.com)
- Icons from [Lucide React](https://lucide.dev)
- Optimized for [Raspberry Pi Foundation](https://www.raspberrypi.org) hardware

## 📞 Support

- Create an issue for bug reports or feature requests
- Check the [Installation Guide](./INSTALLATION.md) for deployment help
- Monitor system health via `/api/memory` endpoint

---

**Made with ❤️ for the Raspberry Pi community**