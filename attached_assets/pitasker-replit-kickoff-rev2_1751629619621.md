~~~markdown
<DOCUMENT filename="pitasker-replit-kickoff-final.md">
# 🚀 PiTasker Development Plan for Replit

## ⏳ Time Constraint
I have **2 days left** on my Replit subscription (until **Sunday, July 06, 2025, 08:43 PM JST**) to build and deploy a new app.

## 🎯 Goal
Create **PiTasker**, a lightweight task scheduler and automation dashboard for Raspberry Pi users, complementing my existing portfolio.

---

## 📦 Context

### 🧩 Existing Apps on piapps.dev
- **Reading-Habit-Tracker**  
  `mybooks.piapps.dev`  
  *Tech:* React + Recharts + Node.js + Express + CSV Parser

- **TableTamer**  
  `tabletamer.piapps.dev`  
  *Tech:* React 18 + TypeScript + Vite + Tailwind + shadcn/ui

- **CodePatchwork**  
  `codepatchwork.com`  
  *Tech:* React + Tailwind + TypeScript + Node.js + PostgreSQL + Firebase

- **MarkdownMate**  
  `markdown.piapps.dev`  
  *Tech:* React 18 + TypeScript + Vite + Tailwind + shadcn/ui + Monaco Editor + Marked.js + DOMPurify

- **KeyJolt**  
  *Demo available*  
  *Tech:* Spring Boot 3 + Java 17 + Thymeleaf + Vanilla JS

- **PiDeck**  
  GitHub: [hexawulf/PiDeck](https://github.com/hexawulf/PiDeck)  
  *Tech:* React 18 + TypeScript + Vite + Tailwind + shadcn/ui + Node.js + Express + PostgreSQL + Drizzle ORM + TanStack Query + Wouter + bcrypt + express-session + child_process  
  *Features:* System monitoring, PM2/Docker/service management, log viewing, cron UI, dark theme

---

## 🛠 Tech Stack

- React 18
- Tailwind CSS
- TypeScript
- Node.js (Express)
- PostgreSQL
- Firebase (for notifications/auth)
- TanStack Query
- child_process
- Additional: `luxon` (timestamps), `zod` (validation)

---

## 🌐 Deployment Target

- Raspberry Pi 5 (Ubuntu 25.04 aarch64)
- Max Memory Footprint: **<100MB** (target <90MB under load)
- Deployment via NGINX + PM2 (no Docker required)

---

## 📘 App Description

**PiTasker** is a task scheduler and automation dashboard for Raspberry Pi users, enabling management of personal and development workflows (e.g., backups, script execution). It builds on PiDeck’s system management theme and my interest in Linux and open-source projects (see https://github.com/hexawulf).

---

## 🔑 Key Features (MVP for 2-Day Build)

- **Task Scheduler:** Create and schedule one-time or recurring tasks (e.g., `0 * * * *`) with a simple UI; tasks stored in PostgreSQL.
- **Real-Time Status:** Show execution state (Pending, Running, Success, Failed) with auto-refresh (TanStack Query).
- **Manual Trigger:** Run tasks on-demand via UI, execute using `child_process.exec()`, with a confirmation dialog.
- **Basic Notifications:** Use Firebase to notify browser on task success or failure.

---

## ✅ Why This Fits

- Complements PiDeck by adding automation to monitoring.
- Reinforces real-time UI, system integration, and backend scheduling logic.
- Adds practical utility for Raspberry Pi server users.
- Matches existing stack and tool familiarity.

---

## ⚙️ Raspberry Pi Deployment Considerations

- Avoid memory-intensive queues or background workers.
- Use Firebase notifications to offload real-time infrastructure.
- Ensure compatibility with existing memory/resource footprint.
- Precompile Tailwind CSS in Replit to reduce runtime overhead.

---

## 🗓 Implementation Timeline

- **Friday, July 04 (Tonight until 11:00 PM JST):**
  - Project setup (Vite + Express + Tailwind + DB)
  - UI layout (task form + table)
  - Design DB schema

- **Saturday, July 05:**
  - Build CRUD API + manual task trigger with validation
  - Add real-time status polling
  - Integrate task runner logic (node-cron + exec)

- **Sunday, July 06 (until 08:43 PM JST):**
  - Firebase browser notifications
  - Testing and bugfixing (ensure <90MB)
  - Final deploy to `pitasker.piapps.dev`

---

## 📋 Requested Starter Plan

### 🔲 UI Layout Suggestions

Single-page dashboard with:
- **Task List Table:** Shows name, schedule, status, last run, actions
- **Add Task Form:** Inputs for name, cron schedule, shell command
- **Status Panel:** Real-time updates using TanStack Query
- **Notification Area:** Toast for task outcome (Firebase)

Use `shadcn/ui` and Tailwind CSS for styling and responsive layout.

---

### 🗃 PostgreSQL Schema

```sql
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  cron_schedule VARCHAR(20),
  command TEXT,
  last_run TIMESTAMP,
  status VARCHAR(20) DEFAULT 'Pending',
  output TEXT
);

-- Suggested Indexes:
CREATE INDEX idx_status ON tasks(status);
CREATE INDEX idx_schedule ON tasks(cron_schedule);
~~~
