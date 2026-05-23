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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
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
	"customer_id" integer NOT NULL,
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
CREATE INDEX "security_events_caller_ip_idx" ON "security_events" USING btree ("caller_ip");