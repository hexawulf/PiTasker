# PiTasker - Task Scheduler & Automation Dashboard

## Overview

PiTasker is a lightweight task scheduler and automation dashboard designed for Raspberry Pi users. It provides a web-based interface for creating, managing, and monitoring scheduled tasks using cron syntax. The application offers real-time task execution monitoring, notifications, and a clean, responsive user interface.

## System Architecture

The application follows a modern full-stack architecture with clear separation between client and server components:

- **Frontend**: React 18 with TypeScript, Vite build system
- **Backend**: Node.js with Express.js server
- **Database**: PostgreSQL with Drizzle ORM
- **Routing**: Wouter for client-side routing
- **State Management**: TanStack Query for server state management
- **Styling**: Tailwind CSS with shadcn/ui component library
- **Real-time Updates**: Polling-based updates every 5 seconds

## Key Components

### Frontend Architecture
- **Component Structure**: Uses shadcn/ui design system for consistent UI components
- **State Management**: TanStack Query handles API calls and caching
- **Form Handling**: React Hook Form with Zod validation
- **Notifications**: Firebase integration for browser notifications
- **Responsive Design**: Mobile-first approach with Tailwind CSS

### Backend Architecture
- **API Design**: RESTful endpoints for CRUD operations on tasks
- **Task Scheduling**: Node-cron for scheduling and executing tasks
- **Task Execution**: Child process execution with timeout protection
- **Database Layer**: Drizzle ORM with PostgreSQL for data persistence
- **Session Management**: Express sessions with PostgreSQL storage

### Database Schema
- **Users Table**: Basic user authentication (username, password)
- **Tasks Table**: Task definitions with scheduling information
  - Fields: id, name, cronSchedule, command, status, lastRun, output, createdAt
  - Status tracking: pending, running, success, failed

## Data Flow

1. **Task Creation**: Frontend form → Validation → API endpoint → Database storage → Task scheduler registration
2. **Task Execution**: Cron trigger → Task runner → Command execution → Database status update → Notification
3. **Real-time Updates**: Frontend polling → API queries → Database reads → UI updates
4. **Notifications**: Task completion → Notification service → Firebase → Browser notifications

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: Neon PostgreSQL database connection
- **drizzle-orm**: Type-safe database ORM
- **node-cron**: Task scheduling functionality
- **@tanstack/react-query**: Server state management
- **wouter**: Lightweight client-side routing

### UI Dependencies
- **@radix-ui/***: Accessible UI primitives
- **tailwindcss**: Utility-first CSS framework
- **lucide-react**: Icon library
- **react-hook-form**: Form handling
- **zod**: Schema validation

### Notification System
- **Firebase**: Browser notifications and messaging
- **connect-pg-simple**: PostgreSQL session storage

## Deployment Strategy

The application is configured for deployment on Replit with the following considerations:

- **Build Process**: Vite builds the client, esbuild bundles the server
- **Environment Variables**: DATABASE_URL for PostgreSQL connection
- **Development**: Hot reload with Vite middleware
- **Production**: Static file serving with Express
- **Database Migrations**: Drizzle Kit for schema management

### Scripts
- `npm run dev`: Development server with hot reload
- `npm run build`: Production build
- `npm run start`: Production server
- `npm run db:push`: Database schema updates

## Changelog
- July 04, 2025: Initial setup complete with core features
  - Database schema with PostgreSQL (users, tasks tables)
  - Complete CRUD API with Express.js routes
  - Task scheduler using node-cron with validation
  - Task runner with child_process execution
  - Real-time status updates with polling
  - Confirmation dialogs for manual task triggers
  - Firebase browser notifications integration
  - Cron validation with Zod and Luxon timestamp handling
  - Responsive UI with shadcn/ui components
  - Memory optimization for <90MB target

## Current Features Implementation Status
✓ Manual task triggers with confirmation dialogs
✓ Firebase notifications with task name and timestamp
✓ Cron validation using Zod
✓ Timestamp handling with Luxon
✓ Real-time status polling every 5 seconds
✓ Task scheduler with node-cron
✓ Health check endpoint (/health)
✓ Modular service architecture

## User Preferences

Preferred communication style: Simple, everyday language.