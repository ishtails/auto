ALTER TABLE "agent_profiles" ADD COLUMN IF NOT EXISTS "schedule_cadence_seconds" integer DEFAULT 0 NOT NULL;
ALTER TABLE "agent_profiles" ADD COLUMN IF NOT EXISTS "schedule_next_run_at" timestamp with time zone;
