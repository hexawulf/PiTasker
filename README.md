# 🍓 PiTasker - Raspberry Pi Task Scheduler & Automation Dashboard

A lightweight, memory-optimized task scheduler and automation dashboard designed specifically for Raspberry Pi systems. Built with modern web technologies and optimized for <90MB memory usage.

![PiTasker Dashboard](https://img.shields.io/badge/Platform-Raspberry%20Pi-red?style=for-the-badge&logo=raspberry-pi)
![Node.js](https://img.shields.io/badge/Node.js-20.18.1-green?style=for-the-badge&logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=for-the-badge&logo=typescript)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue?style=for-the-badge&logo=postgresql)

## ✨ Features

- **🕒 Cron-based Task Scheduling** - Schedule tasks using standard cron syntax with real-time validation
- **⚡ Manual Task Execution** - Run tasks on-demand with confirmation dialogs
- **📊 Real-time Monitoring** - Live dashboard with task statistics and system memory tracking
- **🔔 Smart Notifications** - Firebase-powered browser notifications for task completion
- **💾 Memory Optimized** - Designed for <90MB RAM usage, perfect for Raspberry Pi
- **🎨 Modern UI** - Responsive design with dark/light mode using shadcn/ui components
- **📈 System Monitoring** - Built-in memory usage monitoring and performance tracking
- **🔄 Auto-restart** - Task scheduler with automatic recovery and health checks

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
- `tasks` - Task definitions with scheduling information

## 📋 API Endpoints

- `GET /health` - Health check with memory usage
- `GET /api/memory` - Detailed memory monitoring
- `GET /api/tasks` - List all tasks
- `POST /api/tasks` - Create new task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task
- `POST /api/tasks/:id/run` - Manual task execution
- `GET /api/tasks/stats` - Task statistics

## 🔄 Task Examples

### Basic Examples
```bash
# Run every minute
*/1 * * * *

# Run daily at 6 AM
0 6 * * *

# Run weekly on Sundays at midnight
0 0 * * 0
```

### Common Pi Tasks
```bash
# System backup
tar -czf /backup/pi-backup-$(date +%Y%m%d).tar.gz /home/pi

# Temperature monitoring
vcgencmd measure_temp >> /var/log/pi-temp.log

# Disk cleanup
find /tmp -type f -atime +7 -delete
```

## 📊 Memory Optimization

PiTasker is specifically optimized for Raspberry Pi memory constraints:

- Target: <90MB RSS memory usage
- Built-in memory monitoring and warnings
- Garbage collection optimization
- Efficient PostgreSQL connection pooling
- Minimal dependency footprint

## 🛠️ Deployment

For production deployment on Raspberry Pi, see [INSTALLATION.md](./INSTALLATION.md) for detailed setup instructions.

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