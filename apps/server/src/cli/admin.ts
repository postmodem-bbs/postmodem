// SPDX-License-Identifier: AGPL-3.0-or-later
// Board administration from the CLI until the web admin panel exists (M2): groups, forums
// and the clean-up of imported password hashes. Every change goes into the audit log.
import type { GroupKind, Id, Node, NodeKind, Repositories } from "@postmodem/core";
import { createContext } from "../lib/server/bootstrap.ts";

const DAY = 86_400_000;

/** `--name value` flags; everything else is positional. Boolean flags have no value. */
export function parseArgs(args: string[], booleans: string[] = []) {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) rest.push(a);
    else if (booleans.includes(a.slice(2))) flags[a.slice(2)] = "true";
    else flags[a.slice(2)] = args[++i] ?? "";
  }
  return { flags, rest };
}

class Usage extends Error {}

async function withRepos(fn: (repos: Repositories) => Promise<number>): Promise<number> {
  const ctx = await createContext({ migrate: false });
  try {
    return await fn(ctx.db.repos);
  } catch (e) {
    if (e instanceof Usage) {
      console.error(e.message);
      return 2;
    }
    throw e;
  } finally {
    await ctx.db.close();
  }
}

const audit = (repos: Repositories, action: string, targetType: string, targetId: Id, details = {}) =>
  repos.audit.append({ actorId: null, action, targetType, targetId: String(targetId), details });

async function userNamed(repos: Repositories, name: string | undefined) {
  if (!name) throw new Usage("missing user name");
  const user = await repos.users.byUsername(name);
  if (!user) throw new Usage(`no user named '${name}'`);
  return user;
}

async function groupNamed(repos: Repositories, name: string | undefined) {
  if (!name) throw new Usage("missing group name");
  const group = await repos.groups.byName(name);
  if (!group) throw new Usage(`no group named '${name}' (see: postmodem group list)`);
  return group;
}

async function nodeWithId(repos: Repositories, raw: string | undefined): Promise<Node> {
  const node = raw && /^\d+$/.test(raw) ? await repos.nodes.get(Number(raw)) : undefined;
  if (!node) throw new Usage(`no forum or category with id '${raw ?? ""}' (see: postmodem forum list)`);
  return node;
}

const GROUP_KINDS: GroupKind[] = ["open", "closed", "hidden"];
const NODE_KINDS: NodeKind[] = ["category", "forum", "link"];

export const GROUP_HELP = `  group list | members <group>
  group create <name> [--kind open|closed|hidden] [--description <text>]
  group add <group> <user> [--moderator] | remove <group> <user>
                manage user groups (phpBB2 group types; hidden groups aren't listed)`;

export function groupCommand(sub: string | undefined, args: string[]): Promise<number> {
  const { flags, rest } = parseArgs(args, ["moderator"]);
  return withRepos(async (repos) => {
    switch (sub) {
      case "list": {
        for (const g of await repos.groups.all()) {
          const members = await repos.groups.members(g.id);
          console.log(`${g.id}\t${g.name}\t${g.kind}\t${members.filter((m) => !m.pending).length} members`);
        }
        return 0;
      }
      case "members": {
        const group = await groupNamed(repos, rest[0]);
        const members = await repos.groups.members(group.id);
        const users = await repos.users.getMany(members.map((m) => m.userId));
        for (const m of members) {
          const tags = [m.role === "moderator" && "moderator", m.pending && "pending"].filter(Boolean);
          console.log(
            `${users.get(m.userId)?.username ?? `#${m.userId}`}${tags.length ? ` (${tags.join(", ")})` : ""}`,
          );
        }
        return 0;
      }
      case "create": {
        const name = rest.join(" ").trim();
        const kind = (flags.kind ?? "closed") as GroupKind;
        if (!name) throw new Usage("usage: postmodem group create <name> [--kind open|closed|hidden]");
        if (!GROUP_KINDS.includes(kind)) throw new Usage(`--kind must be one of ${GROUP_KINDS.join(", ")}`);
        if (await repos.groups.byName(name)) throw new Usage(`a group named '${name}' already exists`);
        const group = await repos.groups.create({ name, kind, description: flags.description ?? "" });
        await audit(repos, "group.created", "group", group.id, { name, kind });
        console.log(`created group ${group.id} '${group.name}' (${kind})`);
        return 0;
      }
      case "add":
      case "remove": {
        const group = await groupNamed(repos, rest[0]);
        const user = await userNamed(repos, rest[1]);
        if (sub === "add") {
          const role = flags.moderator ? "moderator" : "member";
          await repos.groups.addMember({ groupId: group.id, userId: user.id, role, pending: false });
          await audit(repos, "group.member_added", "group", group.id, { userId: user.id, role });
          console.log(`${user.username} is now a ${role} of '${group.name}'`);
        } else {
          await repos.groups.removeMember(group.id, user.id);
          await audit(repos, "group.member_removed", "group", group.id, { userId: user.id });
          console.log(`${user.username} is no longer in '${group.name}'`);
        }
        return 0;
      }
    }
    throw new Usage(`usage:\n${GROUP_HELP}`);
  });
}

export const FORUM_HELP = `  forum list
  forum create <title> [--kind forum|category|link] [--parent <id>] [--description <text>]
               [--url <link target>] [--position <n>]
  forum update <id> [--title <t>] [--description <d>] [--locked true|false] [--position <n>]
  forum move <id> --parent <id|top> [--position <n>]
  forum recount [<id>]
                manage the forum tree (ids as shown by forum list); recount fixes stale
                topic/post counters for one forum or all of them`;

export function forumCommand(sub: string | undefined, args: string[]): Promise<number> {
  const { flags, rest } = parseArgs(args);
  const position = () => {
    if (flags.position === undefined) return undefined;
    if (!/^\d+$/.test(flags.position)) throw new Usage("--position must be a whole number");
    return Number(flags.position);
  };
  return withRepos(async (repos) => {
    switch (sub) {
      case "list": {
        for (const n of await repos.nodes.tree()) {
          const indent = "  ".repeat(n.depth);
          const counts = n.kind === "forum" ? `  ${n.topicCount} topics, ${n.postCount} posts` : "";
          const tags = [n.kind !== "forum" && n.kind, n.locked && "locked"].filter(Boolean);
          console.log(
            `${String(n.id).padStart(5)}  ${indent}${n.title}${tags.length ? ` [${tags.join(", ")}]` : ""}${counts}`,
          );
        }
        return 0;
      }
      case "create": {
        const title = rest.join(" ").trim();
        const kind = (flags.kind ?? "forum") as NodeKind;
        if (!title) throw new Usage(`usage:\n${FORUM_HELP}`);
        if (!NODE_KINDS.includes(kind)) throw new Usage(`--kind must be one of ${NODE_KINDS.join(", ")}`);
        if (kind === "link" && !flags.url) throw new Usage("a link needs --url");
        const parent = flags.parent ? await nodeWithId(repos, flags.parent) : null;
        if (parent?.kind === "link") throw new Usage("a link can't contain anything");
        const node = await repos.nodes.create({
          parentId: parent?.id ?? null,
          kind,
          title,
          description: flags.description ?? "",
          linkUrl: kind === "link" ? flags.url : null,
          position: position(),
        });
        await audit(repos, "node.created", "node", node.id, { title, kind, parentId: node.parentId });
        console.log(`created ${kind} ${node.id} '${node.title}'${parent ? ` in '${parent.title}'` : ""}`);
        return 0;
      }
      case "update": {
        const node = await nodeWithId(repos, rest[0]);
        const patch: Parameters<Repositories["nodes"]["update"]>[1] = {};
        if (flags.title !== undefined) patch.title = flags.title;
        if (flags.description !== undefined) patch.description = flags.description;
        if (flags.locked !== undefined) {
          if (!["true", "false"].includes(flags.locked)) throw new Usage("--locked must be true or false");
          patch.locked = flags.locked === "true";
        }
        if (flags.position !== undefined) patch.position = position();
        if (!Object.keys(patch).length) throw new Usage(`nothing to change\n${FORUM_HELP}`);
        const updated = await repos.nodes.update(node.id, patch);
        await audit(repos, "node.updated", "node", node.id, patch);
        console.log(`updated ${updated.kind} ${updated.id} '${updated.title}'`);
        return 0;
      }
      case "move": {
        const node = await nodeWithId(repos, rest[0]);
        if (!flags.parent) throw new Usage("usage: postmodem forum move <id> --parent <id|top>");
        const parent = flags.parent === "top" ? null : await nodeWithId(repos, flags.parent);
        if (parent?.kind === "link") throw new Usage("a link can't contain anything");
        try {
          await repos.nodes.move(node.id, parent?.id ?? null, position());
        } catch (e) {
          throw new Usage((e as Error).message);
        }
        await audit(repos, "node.moved", "node", node.id, { from: node.parentId, to: parent?.id ?? null });
        console.log(`moved '${node.title}' ${parent ? `into '${parent.title}'` : "to the top level"}`);
        return 0;
      }
      case "recount": {
        const nodes = rest[0] ? [await nodeWithId(repos, rest[0])] : await repos.nodes.tree();
        for (const n of nodes) {
          if (n.kind === "link") continue;
          const fresh = await repos.nodes.recount(n.id);
          if (fresh.topicCount !== n.topicCount || fresh.postCount !== n.postCount)
            console.log(
              `${n.id} '${n.title}': ${n.topicCount}→${fresh.topicCount} topics, ${n.postCount}→${fresh.postCount} posts`,
            );
        }
        console.log(`recounted ${nodes.length} node(s)`);
        return 0;
      }
    }
    throw new Usage(`usage:\n${FORUM_HELP}`);
  });
}

export const USER_EXPIRE_HELP = `  user expire-legacy-passwords --inactive-months <n> [--dry-run]
                delete imported phpBB2/phpass password hashes of accounts that haven't
                signed in for n months (or ever); they sign in again via a password reset`;

/** M1 risk table: unsalted MD5 hashes shouldn't sit in the database for years. */
export function expireLegacyPasswords(args: string[]): Promise<number> {
  const { flags } = parseArgs(args, ["dry-run"]);
  return withRepos(async (repos) => {
    const months = Number(flags["inactive-months"]);
    if (!Number.isInteger(months) || months < 1) throw new Usage(`usage:\n${USER_EXPIRE_HELP}`);
    const before = Date.now() - months * 30 * DAY;
    const stale = await repos.credentials.legacyUnusedSince(before);
    const bySchemes = Object.entries(Object.groupBy(stale, (s) => s.scheme))
      .map(([scheme, rows]) => `${rows!.length} ${scheme}`)
      .join(", ");
    if (flags["dry-run"]) {
      console.log(`would expire ${stale.length} legacy password(s)${bySchemes ? ` (${bySchemes})` : ""}`);
      return 0;
    }
    await repos.transaction(async (r) => {
      for (const s of stale) await r.credentials.remove(s.userId);
      await r.audit.append({
        actorId: null,
        action: "credentials.legacy_expired",
        targetType: "board",
        targetId: "",
        details: { count: stale.length, inactiveMonths: months },
      });
    });
    console.log(`expired ${stale.length} legacy password(s)${bySchemes ? ` (${bySchemes})` : ""}`);
    return 0;
  });
}
