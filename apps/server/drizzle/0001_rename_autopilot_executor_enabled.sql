DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'agent_profiles'
			AND column_name = 'autopilot'
	) THEN
		ALTER TABLE "agent_profiles" RENAME COLUMN "autopilot" TO "executor_enabled";
	ELSIF NOT EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'agent_profiles'
			AND column_name = 'executor_enabled'
	) THEN
		ALTER TABLE "agent_profiles" ADD COLUMN "executor_enabled" boolean DEFAULT false NOT NULL;
	END IF;
END $$;
