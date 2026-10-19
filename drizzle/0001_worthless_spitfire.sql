ALTER TABLE "usage_requests" DROP CONSTRAINT "usage_requests_account_id_user_id_users_account_id_id_fk";
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "api_key_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "account_name_snapshot" varchar(120);--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "user_name_snapshot" varchar(120);--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "account_plan_id_snapshot" uuid;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "account_plan_name_snapshot" varchar(100);--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "account_monthly_allowance_snapshot" integer;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "account_max_units_per_request_snapshot" integer;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "user_plan_id_snapshot" uuid;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "user_plan_name_snapshot" varchar(100);--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "user_monthly_allowance_snapshot" integer;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "user_max_units_per_request_snapshot" integer;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "account_usage_before" integer;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "account_usage_after" integer;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "user_usage_before" integer;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "user_usage_after" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_account_id_user_id_users_account_id_id_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."users"("account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plans_owner_account_id_idx" ON "plans" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "usage_requests_account_created_idx" ON "usage_requests" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_requests_account_user_month_idx" ON "usage_requests" USING btree ("account_id","user_id","month_start");--> statement-breakpoint
CREATE INDEX "users_account_id_idx" ON "users" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "users_plan_id_idx" ON "users" USING btree ("plan_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_api_key_prefix_format" CHECK ("accounts"."api_key_prefix" ~ '^fts_[a-f0-9]{20}$');--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_api_key_hash_format" CHECK ("accounts"."api_key_hash" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_request_within_allowance" CHECK ("plans"."max_units_per_request" <= "plans"."monthly_allowance");--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_ownership_consistency" CHECK ((
        "plans"."is_predefined" = true
        AND "plans"."owner_account_id" IS NULL
      ) OR (
        "plans"."is_predefined" = false
        AND "plans"."owner_account_id" IS NOT NULL
        AND "plans"."scope" = 'user'
      ));--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_reasons_array" CHECK (jsonb_typeof("usage_requests"."rejection_reasons") = 'array');--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_snapshot_consistency" CHECK ((
        "usage_requests"."account_name_snapshot" IS NULL
        AND "usage_requests"."user_name_snapshot" IS NULL
        AND "usage_requests"."account_plan_id_snapshot" IS NULL
        AND "usage_requests"."account_plan_name_snapshot" IS NULL
        AND "usage_requests"."account_monthly_allowance_snapshot" IS NULL
        AND "usage_requests"."account_max_units_per_request_snapshot" IS NULL
        AND "usage_requests"."user_plan_id_snapshot" IS NULL
        AND "usage_requests"."user_plan_name_snapshot" IS NULL
        AND "usage_requests"."user_monthly_allowance_snapshot" IS NULL
        AND "usage_requests"."user_max_units_per_request_snapshot" IS NULL
        AND "usage_requests"."account_usage_before" IS NULL
        AND "usage_requests"."account_usage_after" IS NULL
        AND "usage_requests"."user_usage_before" IS NULL
        AND "usage_requests"."user_usage_after" IS NULL
      ) OR (
        "usage_requests"."account_name_snapshot" IS NOT NULL
        AND "usage_requests"."user_name_snapshot" IS NOT NULL
        AND "usage_requests"."account_plan_id_snapshot" IS NOT NULL
        AND "usage_requests"."account_plan_name_snapshot" IS NOT NULL
        AND "usage_requests"."account_monthly_allowance_snapshot" IS NOT NULL
        AND "usage_requests"."account_max_units_per_request_snapshot" IS NOT NULL
        AND "usage_requests"."user_plan_id_snapshot" IS NOT NULL
        AND "usage_requests"."user_plan_name_snapshot" IS NOT NULL
        AND "usage_requests"."user_monthly_allowance_snapshot" IS NOT NULL
        AND "usage_requests"."user_max_units_per_request_snapshot" IS NOT NULL
        AND "usage_requests"."account_usage_before" IS NOT NULL
        AND "usage_requests"."account_usage_after" IS NOT NULL
        AND "usage_requests"."user_usage_before" IS NOT NULL
        AND "usage_requests"."user_usage_after" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_nonnegative_snapshots" CHECK ((
        "usage_requests"."account_usage_before" IS NULL
      ) OR (
        "usage_requests"."account_usage_before" >= 0
        AND "usage_requests"."account_usage_after" >= 0
        AND "usage_requests"."user_usage_before" >= 0
        AND "usage_requests"."user_usage_after" >= 0
      ));--> statement-breakpoint
CREATE FUNCTION enforce_account_plan_assignment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  selected_scope plan_scope;
  selected_predefined boolean;
  selected_owner uuid;
BEGIN
  SELECT scope, is_predefined, owner_account_id
    INTO selected_scope, selected_predefined, selected_owner
  FROM plans
  WHERE id = NEW.plan_id;

  IF selected_scope IS DISTINCT FROM 'account'::plan_scope
     OR selected_predefined IS DISTINCT FROM true
     OR selected_owner IS NOT NULL THEN
    RAISE EXCEPTION 'account plan must be a global predefined account plan'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER accounts_plan_scope_guard
AFTER INSERT OR UPDATE OF plan_id ON accounts
FOR EACH ROW EXECUTE FUNCTION enforce_account_plan_assignment();--> statement-breakpoint
CREATE FUNCTION enforce_user_plan_assignment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  selected_scope plan_scope;
  selected_predefined boolean;
  selected_owner uuid;
BEGIN
  SELECT scope, is_predefined, owner_account_id
    INTO selected_scope, selected_predefined, selected_owner
  FROM plans
  WHERE id = NEW.plan_id;

  IF selected_scope IS DISTINCT FROM 'user'::plan_scope
     OR NOT (
       (selected_predefined = true AND selected_owner IS NULL)
       OR (selected_predefined = false AND selected_owner = NEW.account_id)
     ) THEN
    RAISE EXCEPTION 'user plan is not assignable to this account'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER users_plan_scope_guard
AFTER INSERT OR UPDATE OF plan_id, account_id ON users
FOR EACH ROW EXECUTE FUNCTION enforce_user_plan_assignment();--> statement-breakpoint
CREATE FUNCTION prevent_invalid_assigned_plan_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounts
    WHERE plan_id = NEW.id
      AND (
        NEW.scope <> 'account'::plan_scope
        OR NEW.is_predefined <> true
        OR NEW.owner_account_id IS NOT NULL
      )
  ) OR EXISTS (
    SELECT 1 FROM users
    WHERE plan_id = NEW.id
      AND (
        NEW.scope <> 'user'::plan_scope
        OR NOT (
          (NEW.is_predefined = true AND NEW.owner_account_id IS NULL)
          OR (
            NEW.is_predefined = false
            AND NEW.owner_account_id = users.account_id
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'plan change would invalidate an existing assignment'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER plans_assignment_guard
AFTER UPDATE OF scope, is_predefined, owner_account_id ON plans
FOR EACH ROW EXECUTE FUNCTION prevent_invalid_assigned_plan_change();
