-- A PiTasker 1.x database as `drizzle-kit push` + connect-pg-simple left it
-- (docs/plans/2.0.md › recon): users, tasks (with the crontab columns), session.
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cron_schedule" text NOT NULL,
	"command" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_run" timestamp,
	"output" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"crontab_id" text,
	"synced_to_crontab" boolean DEFAULT false,
	"crontab_synced_at" timestamp,
	"source" text DEFAULT 'pitasker',
	"is_system_managed" boolean DEFAULT true,
	CONSTRAINT "tasks_crontab_id_unique" UNIQUE("crontab_id")
);
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
CREATE TABLE "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
) WITH (OIDS=FALSE);
ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "IDX_session_expire" ON "session" ("expire");

INSERT INTO users (username, password) VALUES ('admin', '$2b$10$abcdefghijklmnopqrstuuJ0kz3h0Hc8K0Yt7Gm7u3Yw9f5b1o1nW');
INSERT INTO session (sid, sess, expire) VALUES ('s1', '{"cookie":{}}', now() + interval '1 day');
-- The stuck rows from the recon: status=running since April, one last_run in the future.
INSERT INTO tasks (id, name, cron_schedule, command, status, last_run, crontab_id, synced_to_crontab, source, is_system_managed) VALUES
  (46, 'poll', '*/5 * * * *', '/home/zk/bin/linuxsvr-status-poll', 'running', '2026-04-02 10:00:00', 'id-46', true, 'crontab', true),
  (57, 'future', '4 7 * * *', '/home/zk/bin/x', 'running', '2026-10-31 07:04:00', 'id-57', true, 'crontab', true),
  (60, 'internal', '0 * * * *', 'echo hi', 'success', '2026-09-29 10:00:00', NULL, false, 'pitasker', false);
SELECT setval('tasks_id_seq', 60);
