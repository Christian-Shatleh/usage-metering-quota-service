CREATE TYPE "public"."decision_status" AS ENUM('accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."plan_scope" AS ENUM('account', 'user');--> statement-breakpoint
CREATE TABLE "account_usage_counters" (
	"account_id" uuid NOT NULL,
	"month_start" date NOT NULL,
	"units_consumed" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_usage_counters_account_id_month_start_pk" PRIMARY KEY("account_id","month_start"),
	CONSTRAINT "account_usage_nonnegative" CHECK ("account_usage_counters"."units_consumed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"api_key_prefix" varchar(24) NOT NULL,
	"api_key_hash" varchar(64) NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_api_key_prefix_unique" UNIQUE("api_key_prefix"),
	CONSTRAINT "accounts_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_account_id" uuid,
	"scope" "plan_scope" NOT NULL,
	"name" varchar(100) NOT NULL,
	"monthly_allowance" integer NOT NULL,
	"max_units_per_request" integer NOT NULL,
	"is_predefined" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_positive_allowance" CHECK ("plans"."monthly_allowance" > 0),
	CONSTRAINT "plans_positive_request_limit" CHECK ("plans"."max_units_per_request" > 0)
);
--> statement-breakpoint
CREATE TABLE "usage_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"requested_units" integer NOT NULL,
	"decision" "decision_status" NOT NULL,
	"rejection_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"month_start" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_requests_idempotency_unique" UNIQUE("account_id","idempotency_key"),
	CONSTRAINT "usage_requests_positive_units" CHECK ("usage_requests"."requested_units" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_usage_counters" (
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"month_start" date NOT NULL,
	"units_consumed" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_usage_counters_account_id_user_id_month_start_pk" PRIMARY KEY("account_id","user_id","month_start"),
	CONSTRAINT "user_usage_nonnegative" CHECK ("user_usage_counters"."units_consumed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"plan_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_account_id_id_unique" UNIQUE("account_id","id")
);
--> statement-breakpoint
ALTER TABLE "account_usage_counters" ADD CONSTRAINT "account_usage_counters_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_account_id_user_id_users_account_id_id_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."users"("account_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_usage_counters" ADD CONSTRAINT "user_usage_counters_account_id_user_id_users_account_id_id_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."users"("account_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;