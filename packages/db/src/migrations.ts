// SPDX-License-Identifier: AGPL-3.0-or-later
// Embedded migrations (bundle-safe; no filesystem lookup). Rules (CONTAINERS.md §4.4):
// append only, expand/contract, never edit a released migration.
// They run without the CamelCasePlugin, so names here are the real snake_case names.

import { skeleton, slugify, USER_SLUG_MAX } from "@postmodem/core";
import { type ColumnDefinitionBuilder, type CreateTableBuilder, type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

export type Dialect = "sqlite" | "pg";

type Db = Kysely<unknown>;
type Table = CreateTableBuilder<string, never>;

/** Auto-generated id that still accepts explicit (legacy) values. */
function withId(t: Table, dialect: Dialect): Table {
  return dialect === "sqlite"
    ? t.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
    : t.addColumn("id", "bigint", (c) => c.primaryKey().generatedByDefaultAsIdentity());
}
const notNull = (c: ColumnDefinitionBuilder) => c.notNull();
const zero = (c: ColumnDefinitionBuilder) => c.notNull().defaultTo(0);
const empty = (c: ColumnDefinitionBuilder) => c.notNull().defaultTo("");

export function migrations(dialect: Dialect): Record<string, Migration> {
  return {
    "0001_settings": {
      // Created by M0 with a hand-written runner; IF NOT EXISTS keeps old dev databases working.
      async up(db: Db) {
        await db.schema
          .createTable("settings")
          .ifNotExists()
          .addColumn("key", "text", (c) => c.primaryKey())
          .addColumn("value", dialect === "pg" ? "jsonb" : "text", notNull)
          .addColumn(
            "updated_at",
            dialect === "pg" ? "timestamptz" : "text",
            dialect === "pg" ? (c) => c.notNull().defaultTo(sql`now()`) : notNull,
          )
          .execute();
      },
    },

    "0002_core_model": {
      async up(db: Db) {
        const s = db.schema;

        await withId(s.createTable("nodes"), dialect)
          .addColumn("parent_id", "bigint", (c) => c.references("nodes.id"))
          .addColumn("path", "text", notNull)
          .addColumn("depth", "integer", zero)
          .addColumn("position", "integer", zero)
          .addColumn("kind", "text", notNull)
          .addColumn("title", "text", notNull)
          .addColumn("slug", "text", notNull)
          .addColumn("description", "text", empty)
          .addColumn("link_url", "text")
          .addColumn("locked", "integer", zero)
          .addColumn("topic_count", "bigint", zero)
          .addColumn("post_count", "bigint", zero)
          .addColumn("last_post_id", "bigint")
          .addColumn("visibility", "text", (c) => c.notNull().defaultTo("core:public"))
          .addColumn("created_at", "bigint", notNull)
          .addColumn("updated_at", "bigint", notNull)
          .execute();
        await s.createIndex("nodes_parent_position").on("nodes").columns(["parent_id", "position"]).execute();
        await s.createIndex("nodes_path").on("nodes").column("path").execute();
        await s.createIndex("nodes_slug").on("nodes").column("slug").unique().execute();

        await withId(s.createTable("users"), dialect)
          .addColumn("username", "text", notNull)
          .addColumn("username_key", "text", notNull)
          .addColumn("email", "text")
          .addColumn("email_key", "text")
          .addColumn("origin", "text", (c) => c.notNull().defaultTo("local"))
          .addColumn("status", "text", (c) => c.notNull().defaultTo("active"))
          .addColumn("created_at", "bigint", notNull)
          .addColumn("last_seen_at", "bigint")
          .addColumn("post_count", "bigint", zero)
          .addColumn("rank_id", "bigint")
          .addColumn("signature_source", "text", empty)
          .addColumn("signature_format", "text", (c) => c.notNull().defaultTo("bbcode-phpbb2"))
          .addColumn("avatar", "text")
          .addColumn("location", "text", empty)
          .addColumn("website", "text", empty)
          .addColumn("locale", "text")
          .addColumn("timezone", "text")
          .execute();
        // Uniqueness per origin: a remote "alice@example.social" may share a name with local alice.
        await s
          .createIndex("users_username_key")
          .on("users")
          .columns(["origin", "username_key"])
          .unique()
          .execute();
        await s.createIndex("users_email_key").on("users").column("email_key").unique().execute(); // NULLs don't collide

        await s
          .createTable("credentials")
          .addColumn("user_id", "bigint", (c) => c.primaryKey().references("users.id").onDelete("cascade"))
          .addColumn("scheme", "text", notNull)
          .addColumn("hash", "text", notNull)
          .addColumn("updated_at", "bigint", notNull)
          .execute();

        await withId(s.createTable("email_tokens"), dialect)
          .addColumn("user_id", "bigint", (c) => c.notNull().references("users.id").onDelete("cascade"))
          .addColumn("purpose", "text", notNull)
          .addColumn("token_hash", "text", (c) => c.notNull().unique())
          .addColumn("expires_at", "bigint", notNull)
          .addColumn("used_at", "bigint")
          .addColumn("created_at", "bigint", notNull)
          .execute();

        await s
          .createTable("sessions")
          .addColumn("id", "text", (c) => c.primaryKey())
          .addColumn("user_id", "bigint", (c) => c.notNull().references("users.id").onDelete("cascade"))
          .addColumn("created_at", "bigint", notNull)
          .addColumn("last_seen_at", "bigint", notNull)
          .addColumn("expires_at", "bigint", notNull)
          .addColumn("user_agent", "text", empty)
          .execute();
        await s.createIndex("sessions_user").on("sessions").column("user_id").execute();
        await s.createIndex("sessions_last_seen").on("sessions").column("last_seen_at").execute();

        await withId(s.createTable("groups"), dialect)
          .addColumn("name", "text", notNull)
          .addColumn("name_key", "text", (c) => c.notNull().unique())
          .addColumn("description", "text", empty)
          .addColumn("kind", "text", notNull)
          .addColumn("created_at", "bigint", notNull)
          .execute();

        await s
          .createTable("memberships")
          .addColumn("group_id", "bigint", (c) => c.notNull().references("groups.id").onDelete("cascade"))
          .addColumn("user_id", "bigint", (c) => c.notNull().references("users.id").onDelete("cascade"))
          .addColumn("role", "text", (c) => c.notNull().defaultTo("member"))
          .addColumn("pending", "integer", zero)
          .addPrimaryKeyConstraint("memberships_pk", ["group_id", "user_id"])
          .execute();
        await s.createIndex("memberships_user").on("memberships").column("user_id").execute();

        await withId(s.createTable("roles"), dialect)
          .addColumn("key", "text", (c) => c.notNull().unique())
          .addColumn("name", "text", notNull)
          .addColumn("builtin", "integer", zero)
          .execute();

        await s
          .createTable("role_capabilities")
          .addColumn("role_id", "bigint", (c) => c.notNull().references("roles.id").onDelete("cascade"))
          .addColumn("capability", "text", notNull)
          .addColumn("effect", "text", notNull)
          .addPrimaryKeyConstraint("role_capabilities_pk", ["role_id", "capability"])
          .execute();

        await withId(s.createTable("grants"), dialect)
          .addColumn("role_id", "bigint", (c) => c.notNull().references("roles.id").onDelete("cascade"))
          .addColumn("subject_type", "text", notNull)
          .addColumn("subject_id", "bigint")
          .addColumn("node_id", "bigint", (c) => c.references("nodes.id").onDelete("cascade"))
          .addColumn("created_at", "bigint", notNull)
          .execute();
        await s.createIndex("grants_node").on("grants").column("node_id").execute();
        await s.createIndex("grants_subject").on("grants").columns(["subject_type", "subject_id"]).execute();

        await withId(s.createTable("topics"), dialect)
          .addColumn("node_id", "bigint", (c) => c.notNull().references("nodes.id"))
          .addColumn("title", "text", notNull)
          .addColumn("slug", "text", notNull)
          .addColumn("author_id", "bigint")
          .addColumn("author_name", "text", empty)
          .addColumn("type", "text", (c) => c.notNull().defaultTo("normal"))
          .addColumn("locked", "integer", zero)
          .addColumn("moved_to_topic_id", "bigint")
          .addColumn("reply_count", "bigint", zero)
          .addColumn("view_count", "bigint", zero)
          .addColumn("first_post_id", "bigint")
          .addColumn("last_post_id", "bigint")
          .addColumn("last_post_at", "bigint")
          .addColumn("visibility", "text", (c) => c.notNull().defaultTo("core:public"))
          .addColumn("created_at", "bigint", notNull)
          .addColumn("updated_at", "bigint", notNull)
          .execute();
        await s
          .createIndex("topics_node_activity")
          .on("topics")
          .columns(["node_id", "visibility", "last_post_at"])
          .execute();
        await s.createIndex("topics_slug").on("topics").column("slug").unique().execute();

        await withId(s.createTable("posts"), dialect)
          .addColumn("topic_id", "bigint", (c) => c.notNull())
          .addColumn("node_id", "bigint", (c) => c.notNull())
          .addColumn("author_id", "bigint")
          .addColumn("author_name", "text", empty)
          .addColumn("source", "text", notNull)
          .addColumn("format", "text", notNull)
          .addColumn("rendered", "text")
          .addColumn("render_version", "integer", zero)
          .addColumn("visibility", "text", (c) => c.notNull().defaultTo("core:public"))
          .addColumn("created_at", "bigint", notNull)
          .addColumn("edited_at", "bigint")
          .addColumn("edit_count", "integer", zero)
          .execute();
        await s
          .createIndex("posts_topic_order")
          .on("posts")
          .columns(["topic_id", "visibility", "created_at", "id"])
          .execute();
        await s.createIndex("posts_node").on("posts").columns(["node_id", "visibility"]).execute();
        await s.createIndex("posts_author").on("posts").column("author_id").execute();

        await withId(s.createTable("ranks"), dialect)
          .addColumn("title", "text", notNull)
          .addColumn("min_posts", "bigint")
          .addColumn("special", "integer", zero)
          .addColumn("image", "text")
          .execute();

        await withId(s.createTable("smilies"), dialect)
          .addColumn("code", "text", (c) => c.notNull().unique())
          .addColumn("image", "text", notNull)
          .addColumn("emotion", "text", empty)
          .addColumn("position", "integer", zero)
          .execute();

        await withId(s.createTable("audit_log"), dialect)
          .addColumn("at", "bigint", notNull)
          .addColumn("actor_id", "bigint")
          .addColumn("action", "text", notNull)
          .addColumn("target_type", "text", notNull)
          .addColumn("target_id", "text", notNull)
          .addColumn("details", "text", (c) => c.notNull().defaultTo("{}"))
          .execute();
        await s.createIndex("audit_log_at").on("audit_log").column("at").execute();

        await s
          .createTable("legacy_ids")
          .addColumn("source", "text", notNull)
          .addColumn("kind", "text", notNull)
          .addColumn("legacy_id", "text", notNull)
          .addColumn("new_id", "bigint", notNull)
          .addPrimaryKeyConstraint("legacy_ids_pk", ["source", "kind", "legacy_id"])
          .execute();

        await s
          .createTable("slug_history")
          .addColumn("kind", "text", notNull)
          .addColumn("slug", "text", notNull)
          .addColumn("entity_id", "bigint", notNull)
          .addColumn("created_at", "bigint", notNull)
          .addPrimaryKeyConstraint("slug_history_pk", ["kind", "slug"])
          .execute();
      },
    },
    "0003_accounts": {
      async up(db: Db) {
        // Board rules acceptance (slice 4): which version of the rules, and when.
        await db.schema.alterTable("users").addColumn("rules_version", "bigint").execute();
        await db.schema.alterTable("users").addColumn("rules_accepted_at", "bigint").execute();
        await db.schema.alterTable("sessions").addColumn("ip", "text", empty).execute();
        // Lookalike-folded username (core `skeleton()`), so "Admin" and Cyrillic "Аdmin" collide.
        await db.schema.alterTable("users").addColumn("username_skeleton", "text", empty).execute();
        const rows = await sql<{ id: number; username: string }>`select id, username from users`.execute(db);
        for (const r of rows.rows)
          await sql`update users set username_skeleton = ${skeleton(r.username)} where id = ${r.id}`.execute(
            db,
          );
        await db.schema
          .createIndex("users_username_skeleton")
          .on("users")
          .column("username_skeleton")
          .execute();
      },
    },
    "0004_jobs_and_throttle": {
      async up(db: Db) {
        const s = db.schema;
        await withId(s.createTable("jobs"), dialect)
          .addColumn("type", "text", notNull)
          .addColumn("payload", "text", (c) => c.notNull().defaultTo("{}"))
          .addColumn("status", "text", (c) => c.notNull().defaultTo("queued"))
          .addColumn("run_at", "bigint", notNull)
          .addColumn("attempts", "integer", zero)
          .addColumn("max_attempts", "integer", (c) => c.notNull().defaultTo(5))
          .addColumn("locked_by", "text")
          .addColumn("locked_until", "bigint")
          .addColumn("last_error", "text", empty)
          .addColumn("created_at", "bigint", notNull)
          .addColumn("finished_at", "bigint")
          .execute();
        await s.createIndex("jobs_due").on("jobs").columns(["status", "run_at"]).execute();

        await s
          .createTable("throttle")
          .addColumn("key", "text", (c) => c.primaryKey())
          .addColumn("failures", "integer", notNull)
          .addColumn("last", "bigint", notNull)
          .execute();
        await s.createIndex("throttle_last").on("throttle").column("last").execute();
        await s.createIndex("email_tokens_user").on("email_tokens").columns(["user_id", "purpose"]).execute();
      },
    },
    "0005_user_slugs": {
      async up(db: Db) {
        // Profile URLs in the numbered and slug styles (ADR 0012): /u/42-alucard, /user/alucard.
        await db.schema.alterTable("users").addColumn("slug", "text", empty).execute();
        const rows = await sql<{
          id: number;
          username: string;
        }>`select id, username from users order by id`.execute(db);
        const taken = new Set<string>();
        for (const r of rows.rows) {
          const base = slugify(r.username, USER_SLUG_MAX) || `user-${r.id}`;
          const slug = taken.has(base) ? `${base}-${r.id}` : base;
          taken.add(slug);
          await sql`update users set slug = ${slug} where id = ${r.id}`.execute(db);
        }
        await db.schema.createIndex("users_slug").on("users").column("slug").unique().execute();
      },
    },
    "0006_listing_indexes": {
      async up(db: Db) {
        // Forum pages list topics announcements first, then stickies, then by last activity
        // (topics.listByNode). Indexing those exact expressions lets SQLite and Postgres walk
        // the index instead of sorting the whole forum on every page view (M1 slice 7).
        await sql`create index topics_node_listing on topics (node_id, visibility,
          (case type when 'announcement' then 0 when 'sticky' then 1 else 2 end),
          (coalesce(last_post_at, created_at)) desc, id desc)`.execute(db);
        // "Newest member" on the index page: local, active, latest first.
        await db.schema
          .createIndex("users_newest")
          .on("users")
          .columns(["origin", "status", "created_at", "id"])
          .execute();
      },
    },
  };
}
