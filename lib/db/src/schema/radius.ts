import { pgTable, bigserial, serial, text, integer, bigint, timestamp, index } from "drizzle-orm/pg-core";

export const radcheckTable = pgTable("radcheck", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  username:  text("username").notNull().default(""),
  attribute: text("attribute").notNull().default(""),
  op:        text("op").notNull().default("=="),
  value:     text("value").notNull().default(""),
}, (t) => [
  index("radcheck_username_idx").on(t.username),
]);
export type Radcheck = typeof radcheckTable.$inferSelect;

export const radreplyTable = pgTable("radreply", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  username:  text("username").notNull().default(""),
  attribute: text("attribute").notNull().default(""),
  op:        text("op").notNull().default("="),
  value:     text("value").notNull().default(""),
}, (t) => [
  index("radreply_username_idx").on(t.username),
]);
export type Radreply = typeof radreplyTable.$inferSelect;

export const radusergroupTable = pgTable("radusergroup", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  username:  text("username").notNull().default(""),
  groupname: text("groupname").notNull().default(""),
  priority:  integer("priority").notNull().default(0),
}, (t) => [
  index("radusergroup_username_idx").on(t.username),
]);
export type Radusergroup = typeof radusergroupTable.$inferSelect;

export const radgroupcheckTable = pgTable("radgroupcheck", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  groupname: text("groupname").notNull().default(""),
  attribute: text("attribute").notNull().default(""),
  op:        text("op").notNull().default("=="),
  value:     text("value").notNull().default(""),
}, (t) => [
  index("radgroupcheck_groupname_idx").on(t.groupname),
]);
export type Radgroupcheck = typeof radgroupcheckTable.$inferSelect;

export const radgroupreplyTable = pgTable("radgroupreply", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  groupname: text("groupname").notNull().default(""),
  attribute: text("attribute").notNull().default(""),
  op:        text("op").notNull().default("="),
  value:     text("value").notNull().default(""),
}, (t) => [
  index("radgroupreply_groupname_idx").on(t.groupname),
]);
export type Radgroupreply = typeof radgroupreplyTable.$inferSelect;

export const radacctTable = pgTable("radacct", {
  radacctid:          bigserial("radacctid",          { mode: "number" }).primaryKey(),
  acctsessionid:      text("acctsessionid").notNull().default(""),
  acctuniqueid:       text("acctuniqueid").notNull().default(""),
  username:           text("username").notNull().default(""),
  realm:              text("realm").default(""),
  nasipaddress:       text("nasipaddress").notNull().default(""),
  nasportid:          text("nasportid"),
  nasporttype:        text("nasporttype"),
  acctstarttime:      timestamp("acctstarttime",    { withTimezone: true }),
  acctupdatetime:     timestamp("acctupdatetime",   { withTimezone: true }),
  acctstoptime:       timestamp("acctstoptime",     { withTimezone: true }),
  acctinterval:       bigint("acctinterval",         { mode: "number" }),
  acctsessiontime:    bigint("acctsessiontime",      { mode: "number" }),
  acctauthentic:      text("acctauthentic"),
  connectinfo_start:  text("connectinfo_start"),
  connectinfo_stop:   text("connectinfo_stop"),
  acctinputoctets:    bigint("acctinputoctets",      { mode: "number" }),
  acctoutputoctets:   bigint("acctoutputoctets",     { mode: "number" }),
  calledstationid:    text("calledstationid").notNull().default(""),
  callingstationid:   text("callingstationid").notNull().default(""),
  acctterminatecause: text("acctterminatecause").notNull().default(""),
  servicetype:        text("servicetype"),
  framedprotocol:     text("framedprotocol"),
  framedipaddress:    text("framedipaddress"),
}, (t) => [
  index("radacct_username_idx").on(t.username),
  index("radacct_acctstarttime_idx").on(t.acctstarttime),
]);
export type Radacct = typeof radacctTable.$inferSelect;

export const radpostauthTable = pgTable("radpostauth", {
  id:               bigserial("id",           { mode: "number" }).primaryKey(),
  username:         text("username").notNull().default(""),
  pass:             text("pass").default(""),
  reply:            text("reply").default(""),
  calledstationid:  text("calledstationid").default(""),
  callingstationid: text("callingstationid").default(""),
  authdate:         timestamp("authdate", { withTimezone: true }).notNull().defaultNow(),
});
export type Radpostauth = typeof radpostauthTable.$inferSelect;

export const radnasTable = pgTable("radnas", {
  id:          serial("id").primaryKey(),
  nasname:     text("nasname").notNull(),
  shortname:   text("shortname"),
  type:        text("type").default("other"),
  ports:       integer("ports"),
  secret:      text("secret").notNull().default("secret"),
  server:      text("server"),
  community:   text("community"),
  description: text("description"),
});
export type Radnas = typeof radnasTable.$inferSelect;
