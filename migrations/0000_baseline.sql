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
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
