CREATE TABLE "customers" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "email" text NOT NULL,
        "phone" text NOT NULL,
        "address" text NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "notes" text,
        "latitude" double precision,
        "longitude" double precision,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "pppoe_username" text;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "pppoe_password" text;
--> statement-breakpoint
CREATE TABLE "plans" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "download_speed" integer NOT NULL,
        "upload_speed" integer NOT NULL,
        "price" numeric(10, 2) NOT NULL,
        "billing_cycle" text DEFAULT 'monthly' NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "ros_profile_name" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
        "id" serial PRIMARY KEY NOT NULL,
        "customer_id" integer NOT NULL,
        "plan_id" integer NOT NULL,
        "router_id" integer,
        "status" text DEFAULT 'active' NOT NULL,
        "start_date" text NOT NULL,
        "end_date" text,
        "ip_address" text,
        "mac_address" text,
        "pppoe_username" text,
        "pppoe_password" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
        "id" serial PRIMARY KEY NOT NULL,
        "customer_id" integer NOT NULL,
        "subscription_id" integer,
        "amount" numeric(10, 2) NOT NULL,
        "tax" numeric(10, 2),
        "total" numeric(10, 2) NOT NULL,
        "status" text DEFAULT 'draft' NOT NULL,
        "due_date" text NOT NULL,
        "paid_at" text,
        "notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
        "id" serial PRIMARY KEY NOT NULL,
        "customer_id" integer,
        "invoice_id" integer,
        "amount" numeric(10, 2) NOT NULL,
        "method" text DEFAULT 'cash' NOT NULL,
        "status" text DEFAULT 'completed' NOT NULL,
        "reference" text,
        "notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_replies" (
        "id" serial PRIMARY KEY NOT NULL,
        "ticket_id" integer NOT NULL,
        "message" text NOT NULL,
        "author" text NOT NULL,
        "is_staff" text DEFAULT 'false' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
        "id" serial PRIMARY KEY NOT NULL,
        "customer_id" integer NOT NULL,
        "subject" text NOT NULL,
        "description" text NOT NULL,
        "status" text DEFAULT 'open' NOT NULL,
        "priority" text DEFAULT 'medium' NOT NULL,
        "category" text,
        "assigned_to" text,
        "resolved_at" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment" (
        "id" serial PRIMARY KEY NOT NULL,
        "customer_id" integer,
        "name" text NOT NULL,
        "type" text DEFAULT 'router' NOT NULL,
        "model" text NOT NULL,
        "brand" text,
        "ip_address" text NOT NULL,
        "mac_address" text,
        "location" text,
        "status" text DEFAULT 'online' NOT NULL,
        "notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_pools" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "network" text NOT NULL,
        "gateway" text NOT NULL,
        "subnet_mask" text NOT NULL,
        "dns1" text,
        "dns2" text,
        "total_ips" integer DEFAULT 0 NOT NULL,
        "used_ips" integer DEFAULT 0 NOT NULL,
        "description" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
        "id" serial PRIMARY KEY NOT NULL,
        "key" text NOT NULL,
        "value" text,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "routers" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "router_type" text DEFAULT 'routeros' NOT NULL,
        "ip_address" text NOT NULL,
        "port" integer,
        "username" text NOT NULL,
        "password" text NOT NULL,
        "description" text,
        "location" text,
        "api_ssl" boolean DEFAULT false,
        "ssh_port" integer,
        "netconf_port" integer,
        "enabled" boolean DEFAULT true NOT NULL,
        "last_seen" timestamp,
        "monitor_state" text,
        "radius_secret" text,
        "radius_port" integer DEFAULT 1812,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routers" ADD COLUMN IF NOT EXISTS "provision_token" text;
--> statement-breakpoint
ALTER TABLE "routers" ADD COLUMN IF NOT EXISTS "provision_status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "routers" ADD COLUMN IF NOT EXISTS "mac_address" text;
--> statement-breakpoint
ALTER TABLE "routers" ADD COLUMN IF NOT EXISTS "ros_version" text;
--> statement-breakpoint
ALTER TABLE "routers" ADD COLUMN IF NOT EXISTS "vpn_connected" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "routers" ADD COLUMN IF NOT EXISTS "last_callback_at" timestamp;
--> statement-breakpoint
ALTER TABLE "routers" ADD COLUMN IF NOT EXISTS "vpn_ip" text;
--> statement-breakpoint
ALTER TABLE "routers" ADD COLUMN IF NOT EXISTS "bridge_ports" text DEFAULT '["ether2"]';
--> statement-breakpoint
--> statement-breakpoint
DO $$ BEGIN
        ALTER TABLE "routers" ADD CONSTRAINT "routers_provision_token_unique" UNIQUE("provision_token");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ── Fiber access / OLT and ONU management ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "olts" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "name" text NOT NULL,
        "vendor" text NOT NULL,
        "model" text NOT NULL,
        "firmware_version" text,
        "pon_technology" text NOT NULL,
        "management_host" text NOT NULL,
        "management_port" integer DEFAULT 161 NOT NULL,
        "management_protocol" text DEFAULT 'snmp-v2c' NOT NULL,
        "encrypted_management_credentials" text NOT NULL,
        "location" text,
        "enabled" boolean DEFAULT true NOT NULL,
        "health_state" text DEFAULT 'unknown' NOT NULL,
        "last_health_check_at" timestamp with time zone,
        "last_discovery_at" timestamp with time zone,
        "last_error" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "olts" ADD COLUMN IF NOT EXISTS "firmware_version" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "olt_pon_ports" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "olt_id" integer NOT NULL,
        "port_number" text NOT NULL,
        "label" text,
        "state" text DEFAULT 'unknown' NOT NULL,
        "optical_state" text,
        "last_seen_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onus" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "olt_id" integer NOT NULL,
        "pon_port_id" integer,
        "serial_number" text,
        "loid" text,
        "vendor" text,
        "model" text,
        "mac_address" text,
        "optical_state" text,
        "rx_power_dbm" text,
        "tx_power_dbm" text,
        "provisioning_state" text DEFAULT 'discovered' NOT NULL,
        "customer_id" integer,
        "last_seen_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "olt_service_profiles" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "vlan_id" integer NOT NULL,
        "access_mode" text NOT NULL,
        "downstream_kbps" integer,
        "upstream_kbps" integer,
        "enabled" boolean DEFAULT true NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "olt_service_profiles" ADD COLUMN IF NOT EXISTS "tr069_inform_interval_seconds" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tr069_acs_configs" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "name" text DEFAULT 'GenieACS' NOT NULL,
        "base_url" text NOT NULL,
        "encrypted_nbi_credentials" text NOT NULL,
        "enabled" boolean DEFAULT true NOT NULL,
        "last_validated_at" timestamp with time zone,
        "last_error" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tr069_devices" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "onu_id" integer NOT NULL,
        "acs_config_id" integer NOT NULL,
        "acs_device_id" text NOT NULL,
        "data_model" text NOT NULL,
        "status" text DEFAULT 'pending_inform' NOT NULL,
        "device_authentication_configured" boolean DEFAULT false NOT NULL,
        "device_authentication_verified_at" timestamp with time zone,
        "data_model_verified_at" timestamp with time zone,
        "last_inform_at" timestamp with time zone,
        "last_managed_at" timestamp with time zone,
        "last_refresh_at" timestamp with time zone,
        "reported_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "last_error" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tr069_commands" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "tr069_device_id" integer NOT NULL,
        "service_profile_id" integer,
        "operation" text DEFAULT 'apply_service_profile' NOT NULL,
        "parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "status" text DEFAULT 'queued' NOT NULL,
        "attempt_count" integer DEFAULT 0 NOT NULL,
        "next_attempt_at" timestamp with time zone,
        "acs_task_id" text,
        "result" jsonb,
        "error" text,
        "recovery_guidance" text,
        "requested_by" text NOT NULL,
        "started_at" timestamp with time zone,
        "completed_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "olt_provisioning_jobs" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "olt_id" integer NOT NULL,
        "onu_id" integer,
        "service_profile_id" integer,
        "operation" text NOT NULL,
        "status" text DEFAULT 'queued' NOT NULL,
        "dry_run" boolean DEFAULT true NOT NULL,
        "requires_approval" boolean DEFAULT true NOT NULL,
        "approved_at" timestamp with time zone,
        "approved_by" text,
        "requested_by" text NOT NULL,
        "result" text,
        "error" text,
        "started_at" timestamp with time zone,
        "completed_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "olts_company_id_idx" ON "olts" ("company_id");
CREATE INDEX IF NOT EXISTS "olts_company_name_idx" ON "olts" ("company_id", "name");
CREATE INDEX IF NOT EXISTS "olt_pon_ports_company_olt_idx" ON "olt_pon_ports" ("company_id", "olt_id");
CREATE INDEX IF NOT EXISTS "olt_pon_ports_lookup_idx" ON "olt_pon_ports" ("olt_id", "port_number");
CREATE UNIQUE INDEX IF NOT EXISTS "olt_pon_ports_company_olt_port_unique" ON "olt_pon_ports" ("company_id", "olt_id", "port_number");
CREATE INDEX IF NOT EXISTS "onus_company_olt_idx" ON "onus" ("company_id", "olt_id");
CREATE INDEX IF NOT EXISTS "onus_company_serial_idx" ON "onus" ("company_id", "serial_number");
CREATE INDEX IF NOT EXISTS "onus_company_customer_idx" ON "onus" ("company_id", "customer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "onus_company_olt_serial_unique" ON "onus" ("company_id", "olt_id", "serial_number");
CREATE INDEX IF NOT EXISTS "olt_service_profiles_company_idx" ON "olt_service_profiles" ("company_id");
CREATE INDEX IF NOT EXISTS "olt_service_profiles_company_name_idx" ON "olt_service_profiles" ("company_id", "name");
CREATE INDEX IF NOT EXISTS "olt_jobs_company_created_idx" ON "olt_provisioning_jobs" ("company_id", "created_at");
CREATE INDEX IF NOT EXISTS "olt_jobs_company_olt_idx" ON "olt_provisioning_jobs" ("company_id", "olt_id");
CREATE INDEX IF NOT EXISTS "olt_jobs_company_onu_idx" ON "olt_provisioning_jobs" ("company_id", "onu_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tr069_acs_configs_company_unique" ON "tr069_acs_configs" ("company_id");
CREATE INDEX IF NOT EXISTS "tr069_acs_configs_company_idx" ON "tr069_acs_configs" ("company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tr069_devices_company_onu_unique" ON "tr069_devices" ("company_id", "onu_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tr069_devices_config_acs_device_unique" ON "tr069_devices" ("acs_config_id", "acs_device_id");
CREATE INDEX IF NOT EXISTS "tr069_devices_company_status_idx" ON "tr069_devices" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "tr069_devices_company_onu_idx" ON "tr069_devices" ("company_id", "onu_id");
CREATE INDEX IF NOT EXISTS "tr069_commands_company_created_idx" ON "tr069_commands" ("company_id", "created_at");
CREATE INDEX IF NOT EXISTS "tr069_commands_company_device_idx" ON "tr069_commands" ("company_id", "tr069_device_id");
CREATE INDEX IF NOT EXISTS "tr069_commands_status_retry_idx" ON "tr069_commands" ("status", "next_attempt_at");
--> statement-breakpoint
CREATE TABLE "hotspot_packages" (
        "id" serial PRIMARY KEY NOT NULL,
        "router_id" integer NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "duration_minutes" integer NOT NULL,
        "data_limit_mb" integer,
        "download_speed_kbps" integer,
        "upload_speed_kbps" integer,
        "price" numeric(10, 2) NOT NULL,
        "currency" text DEFAULT 'KES' NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hotspot_vouchers" (
        "id" serial PRIMARY KEY NOT NULL,
        "router_id" integer NOT NULL,
        "package_id" integer,
        "username" text NOT NULL,
        "password" text NOT NULL,
        "phone" text NOT NULL,
        "mac_address" text,
        "ip_address" text,
        "checkout_request_id" text,
        "mpesa_ref" text,
        "amount_paid" numeric(10, 2),
        "status" text DEFAULT 'pending' NOT NULL,
        "expires_at" timestamp,
        "activated_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "hotspot_vouchers_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "usage_snapshots" (
        "id" serial PRIMARY KEY NOT NULL,
        "subscription_id" integer NOT NULL,
        "bytes_in" bigint DEFAULT 0 NOT NULL,
        "bytes_out" bigint DEFAULT 0 NOT NULL,
        "recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_logs" (
        "id" serial PRIMARY KEY NOT NULL,
        "customer_id" integer NOT NULL,
        "subscription_id" integer NOT NULL,
        "pppoe_username" text,
        "ip_address" text,
        "mac_address" text,
        "session_type" text DEFAULT 'pppoe' NOT NULL,
        "router_name" text,
        "bytes_in" bigint DEFAULT 0 NOT NULL,
        "bytes_out" bigint DEFAULT 0 NOT NULL,
        "session_start" timestamp DEFAULT now() NOT NULL,
        "session_end" timestamp
);
--> statement-breakpoint
CREATE TABLE "customer_communications" (
        "id" serial PRIMARY KEY NOT NULL,
        "customer_id" integer NOT NULL,
        "type" text DEFAULT 'note' NOT NULL,
        "direction" text DEFAULT 'outbound' NOT NULL,
        "subject" text,
        "content" text NOT NULL,
        "sent_by" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_templates" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "trigger_type" text DEFAULT 'manual' NOT NULL,
        "message" text NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_logs" (
        "id" serial PRIMARY KEY NOT NULL,
        "customer_id" integer,
        "subscription_id" integer,
        "phone" text NOT NULL,
        "message" text NOT NULL,
        "template_id" integer,
        "trigger_type" text DEFAULT 'manual' NOT NULL,
        "status" text DEFAULT 'sent' NOT NULL,
        "error" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "splitters" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "latitude" double precision,
        "longitude" double precision,
        "router_id" integer,
        "capacity" integer DEFAULT 8,
        "location" text,
        "fiber_color" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "router_vpn_certs" (
        "id" serial PRIMARY KEY NOT NULL,
        "router_id" integer NOT NULL,
        "router_name" text NOT NULL,
        "client_cert" text,
        "client_key" text,
        "vpn_ip" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "vpn_config" (
        "id" serial PRIMARY KEY NOT NULL,
        "server_public_ip" text,
        "vpn_port" integer DEFAULT 1194,
        "vpn_protocol" text DEFAULT 'tcp',
        "vpn_subnet" text DEFAULT '10.8.0.0',
        "vpn_subnet_mask" text DEFAULT '255.255.255.0',
        "vpn_dns" text DEFAULT '8.8.8.8',
        "ca_cert" text,
        "ca_key" text,
        "server_cert" text,
        "server_key" text,
        "is_configured" boolean DEFAULT false,
        "certs_generated_at" timestamp,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "account_id" text NOT NULL,
        "provider_id" text NOT NULL,
        "access_token" text,
        "refresh_token" text,
        "id_token" text,
        "expires_at" timestamp,
        "password" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "expires_at" timestamp NOT NULL,
        "token" text NOT NULL,
        "ip_address" text,
        "user_agent" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
        "id" text PRIMARY KEY NOT NULL,
        "email" text NOT NULL,
        "name" text NOT NULL,
        "email_verified" boolean DEFAULT false NOT NULL,
        "image" text,
        "role" text DEFAULT 'admin' NOT NULL,
        "active" boolean DEFAULT true NOT NULL,
        "phone" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" text;
--> statement-breakpoint
CREATE TABLE "verifications" (
        "id" text PRIMARY KEY NOT NULL,
        "identifier" text NOT NULL,
        "value" text NOT NULL,
        "expires_at" timestamp NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "user_email" text,
        "action" text NOT NULL,
        "entity_type" text NOT NULL,
        "entity_id" integer,
        "diff" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_purge_log" (
        "id" serial PRIMARY KEY NOT NULL,
        "purged_at" timestamp with time zone DEFAULT now() NOT NULL,
        "deleted_count" integer NOT NULL,
        "triggered_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radacct" (
        "radacctid" bigserial PRIMARY KEY NOT NULL,
        "acctsessionid" text DEFAULT '' NOT NULL,
        "acctuniqueid" text DEFAULT '' NOT NULL,
        "username" text DEFAULT '' NOT NULL,
        "realm" text DEFAULT '',
        "nasipaddress" text DEFAULT '' NOT NULL,
        "nasportid" text,
        "nasporttype" text,
        "acctstarttime" timestamp with time zone,
        "acctupdatetime" timestamp with time zone,
        "acctstoptime" timestamp with time zone,
        "acctinterval" bigint,
        "acctsessiontime" bigint,
        "acctauthentic" text,
        "connectinfo_start" text,
        "connectinfo_stop" text,
        "acctinputoctets" bigint,
        "acctoutputoctets" bigint,
        "calledstationid" text DEFAULT '' NOT NULL,
        "callingstationid" text DEFAULT '' NOT NULL,
        "acctterminatecause" text DEFAULT '' NOT NULL,
        "servicetype" text,
        "framedprotocol" text,
        "framedipaddress" text
);
--> statement-breakpoint
CREATE TABLE "radcheck" (
        "id" bigserial PRIMARY KEY NOT NULL,
        "username" text DEFAULT '' NOT NULL,
        "attribute" text DEFAULT '' NOT NULL,
        "op" text DEFAULT '==' NOT NULL,
        "value" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radgroupcheck" (
        "id" bigserial PRIMARY KEY NOT NULL,
        "groupname" text DEFAULT '' NOT NULL,
        "attribute" text DEFAULT '' NOT NULL,
        "op" text DEFAULT '==' NOT NULL,
        "value" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radgroupreply" (
        "id" bigserial PRIMARY KEY NOT NULL,
        "groupname" text DEFAULT '' NOT NULL,
        "attribute" text DEFAULT '' NOT NULL,
        "op" text DEFAULT '=' NOT NULL,
        "value" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radnas" (
        "id" serial PRIMARY KEY NOT NULL,
        "nasname" text NOT NULL,
        "shortname" text,
        "type" text DEFAULT 'other',
        "ports" integer,
        "secret" text DEFAULT 'secret' NOT NULL,
        "server" text,
        "community" text,
        "description" text
);
--> statement-breakpoint
CREATE TABLE "radpostauth" (
        "id" bigserial PRIMARY KEY NOT NULL,
        "username" text DEFAULT '' NOT NULL,
        "pass" text DEFAULT '',
        "reply" text DEFAULT '',
        "calledstationid" text DEFAULT '',
        "callingstationid" text DEFAULT '',
        "authdate" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radreply" (
        "id" bigserial PRIMARY KEY NOT NULL,
        "username" text DEFAULT '' NOT NULL,
        "attribute" text DEFAULT '' NOT NULL,
        "op" text DEFAULT '=' NOT NULL,
        "value" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radusergroup" (
        "id" bigserial PRIMARY KEY NOT NULL,
        "username" text DEFAULT '' NOT NULL,
        "groupname" text DEFAULT '' NOT NULL,
        "priority" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vpn_configs" (
        "id" serial PRIMARY KEY NOT NULL,
        "customer_id" integer,
        "router_id" integer,
        "common_name" text NOT NULL,
        "ovpn_config" text NOT NULL,
        "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
        "revoked_at" timestamp with time zone,
        "revoked_by" text,
        CONSTRAINT "vpn_configs_common_name_unique" UNIQUE("common_name")
);
--> statement-breakpoint
CREATE TABLE "security_events" (
        "id" serial PRIMARY KEY NOT NULL,
        "event_type" text DEFAULT 'blocked_callback' NOT NULL,
        "caller_ip" text NOT NULL,
        "endpoint" text NOT NULL,
        "method" text DEFAULT 'POST' NOT NULL,
        "reason" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_replies" ADD CONSTRAINT "ticket_replies_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotspot_packages" ADD CONSTRAINT "hotspot_packages_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotspot_vouchers" ADD CONSTRAINT "hotspot_vouchers_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotspot_vouchers" ADD CONSTRAINT "hotspot_vouchers_package_id_hotspot_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."hotspot_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_snapshots" ADD CONSTRAINT "usage_snapshots_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_communications" ADD CONSTRAINT "customer_communications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "splitters" ADD CONSTRAINT "splitters_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vpn_configs" ADD CONSTRAINT "vpn_configs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vpn_configs" ADD CONSTRAINT "vpn_configs_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscriptions_customer_id_idx" ON "subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_customer_id_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_created_at_idx" ON "invoices" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tickets_customer_id_idx" ON "tickets" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "equipment_customer_id_idx" ON "equipment" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "usage_snapshots_subscription_id_idx" ON "usage_snapshots" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "usage_snapshots_recorded_at_idx" ON "usage_snapshots" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "session_logs_customer_id_idx" ON "session_logs" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "session_logs_subscription_id_idx" ON "session_logs" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "session_logs_session_start_idx" ON "session_logs" USING btree ("session_start");--> statement-breakpoint
CREATE INDEX "session_logs_ip_address_idx" ON "session_logs" USING btree ("ip_address");--> statement-breakpoint
CREATE INDEX "session_logs_mac_address_idx" ON "session_logs" USING btree ("mac_address");--> statement-breakpoint
CREATE INDEX "customer_comms_customer_id_idx" ON "customer_communications" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_comms_created_at_idx" ON "customer_communications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sms_logs_customer_id_idx" ON "sms_logs" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sms_logs_created_at_idx" ON "sms_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sms_logs_trigger_type_idx" ON "sms_logs" USING btree ("trigger_type");--> statement-breakpoint
CREATE INDEX "sms_logs_subscription_trigger_idx" ON "sms_logs" USING btree ("subscription_id","trigger_type");--> statement-breakpoint
CREATE INDEX "splitters_router_id_idx" ON "splitters" USING btree ("router_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "radacct_username_idx" ON "radacct" USING btree ("username");--> statement-breakpoint
CREATE INDEX "radacct_acctstarttime_idx" ON "radacct" USING btree ("acctstarttime");--> statement-breakpoint
CREATE INDEX "radcheck_username_idx" ON "radcheck" USING btree ("username");--> statement-breakpoint
CREATE INDEX "radgroupcheck_groupname_idx" ON "radgroupcheck" USING btree ("groupname");--> statement-breakpoint
CREATE INDEX "radgroupreply_groupname_idx" ON "radgroupreply" USING btree ("groupname");--> statement-breakpoint
CREATE INDEX "radreply_username_idx" ON "radreply" USING btree ("username");--> statement-breakpoint
CREATE INDEX "radusergroup_username_idx" ON "radusergroup" USING btree ("username");--> statement-breakpoint
CREATE INDEX "security_events_event_type_idx" ON "security_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "security_events_created_at_idx" ON "security_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "security_events_caller_ip_idx" ON "security_events" USING btree ("caller_ip");--> statement-breakpoint
CREATE TABLE "blocked_ips" (
        "id" serial PRIMARY KEY NOT NULL,
        "ip" text NOT NULL,
        "blocked_at" timestamp DEFAULT now() NOT NULL,
        "expires_at" timestamp NOT NULL,
        "attempt_count" integer DEFAULT 0 NOT NULL,
        "reason" text NOT NULL,
        CONSTRAINT "blocked_ips_ip_unique" UNIQUE("ip")
);
--> statement-breakpoint
CREATE INDEX "blocked_ips_ip_idx" ON "blocked_ips" USING btree ("ip");--> statement-breakpoint
CREATE INDEX "blocked_ips_expires_at_idx" ON "blocked_ips" USING btree ("expires_at");--> statement-breakpoint
CREATE TABLE "dns_observations" (
        "id" serial PRIMARY KEY NOT NULL,
        "router_id" integer NOT NULL,
        "domain" text NOT NULL,
        "category" text DEFAULT 'other' NOT NULL,
        "hit_count" integer DEFAULT 1 NOT NULL,
        "recorded_date" date NOT NULL,
        "last_seen" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "dns_obs_unique_idx" UNIQUE("router_id","domain","recorded_date")
);
--> statement-breakpoint
ALTER TABLE "dns_observations" ADD CONSTRAINT "dns_observations_router_id_routers_id_fk" FOREIGN KEY ("router_id") REFERENCES "public"."routers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dns_obs_router_date_idx" ON "dns_observations" USING btree ("router_id","recorded_date");--> statement-breakpoint
CREATE INDEX "dns_obs_domain_idx" ON "dns_observations" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "dns_obs_category_idx" ON "dns_observations" USING btree ("category");--> statement-breakpoint
CREATE TABLE "conversations" (
        "id" serial PRIMARY KEY NOT NULL,
        "title" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
        "id" serial PRIMARY KEY NOT NULL,
        "conversation_id" integer NOT NULL,
        "role" text NOT NULL,
        "content" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ── Multi-tenant SaaS conversion ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "companies" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "username" text NOT NULL,
        "owner_email" text NOT NULL,
        "owner_phone" text,
        "access_status" text DEFAULT 'active' NOT NULL,
        "exempt" boolean DEFAULT false NOT NULL,
        "access_until" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "companies_username_unique" UNIQUE("username")
);
--> statement-breakpoint
INSERT INTO "companies" ("id", "name", "username", "owner_email", "access_status", "exempt")
        VALUES (1, 'Default Company', 'DEFAULT', 'owner@localhost', 'active', true)
        ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
SELECT setval('companies_id_seq', GREATEST((SELECT MAX(id) FROM companies), 1));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_inactivity_digest_log" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "digest_date" date NOT NULL,
        "recipient_email" text NOT NULL,
        "affected_count" integer NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "processing_started_at" timestamp with time zone DEFAULT now() NOT NULL,
        "sent_at" timestamp with time zone,
        "error" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_inactivity_digest_company_date_idx"
ON "staff_inactivity_digest_log" USING btree ("company_id","digest_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_renewals" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "provider" text NOT NULL,
        "external_ref" text NOT NULL,
        "months" integer NOT NULL,
        "amount" numeric NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "completed_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
        ALTER TABLE "company_renewals" ADD CONSTRAINT "company_renewals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_id" integer;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_password_attempts" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_locked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "company_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "company_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "company_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "company_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "company_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "company_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "company_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "ip_pools" ADD COLUMN IF NOT EXISTS "company_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "routers" ADD COLUMN IF NOT EXISTS "company_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "company_id" integer;
--> statement-breakpoint

-- ── Per-company M-Pesa Daraja credentials ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "company_mpesa_configs" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "consumer_key" text,
        "consumer_secret" text,
        "shortcode" text,
        "passkey" text,
        "paybill_number" text,
        "env" text DEFAULT 'sandbox' NOT NULL,
        "callback_url" text,
        "allowed_ips" text,
        "webhook_secret" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "company_mpesa_configs_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
DO $$ BEGIN
        ALTER TABLE "company_mpesa_configs" ADD CONSTRAINT "company_mpesa_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- Fresh-install baseline only. Production upgrades apply the matching,
-- recorded delta in deploy/migrations/0002_staff_inactivity_digest_log.sql.
CREATE TABLE IF NOT EXISTS "staff_inactivity_digest_log" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
        "digest_date" date NOT NULL,
        "recipient_email" text NOT NULL,
        "affected_count" integer NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "processing_started_at" timestamp with time zone DEFAULT now() NOT NULL,
        "sent_at" timestamp with time zone,
        "error" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_inactivity_digest_company_date_idx"
        ON "staff_inactivity_digest_log" ("company_id", "digest_date");
