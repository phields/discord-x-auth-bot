import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { discordApp } from "../src/discord";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");

async function click(t: Parameters<Parameters<typeof test>[1]>[0], options: {
  existing?: boolean; guildId?: string; grantStatus?: number; removeStatus?: number; networkError?: boolean;
} = {}) {
  const calls: { method: string; url: string; body: Record<string, unknown> }[] = [];
  const writes: string[] = [];
  const roles = new Set(["unverified"]);
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = String(input);
    const method = init.method!;
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : {} });
    if (method === "PATCH") return Response.json({ id: "reply" });
    assert.match(url, /^https:\/\/discord.com\/api\/v10\/guilds\/guild\/members\/user\/roles\//);
    if (options.networkError) throw new TypeError("network failure");
    const status = method === "PUT" ? options.grantStatus ?? 204 : options.removeStatus ?? 204;
    if (status === 204) {
      if (method === "PUT") roles.add("member");
      else roles.delete("unverified");
    }
    return new Response(null, { status });
  });
  const env = {
    DISCORD_APPID: "app", DISCORD_PUBLIC_KEY: publicKey, DISCORD_TOKEN: "test-only",
    DISCORD_GUILD_ID: "guild", DISCORD_VERIFIED: "member", DISCORD_UNVERIFIED: "unverified",
    X_CLIENT_ID: "client", X_REDIRECT_URI: "https://example.com/callback", OAUTH_STATE_TTL_SECONDS: "7200",
    DB: { prepare(sql: string) {
      return { bind() { return this; }, async first() { return options.existing === false ? null : { x_username: "returning_user" }; },
        async run() { writes.push(sql); return { meta: { changes: 1 } }; } };
    } },
  };
  const body = JSON.stringify({ type: 3, id: "interaction", application_id: "app", token: "test-only",
    guild_id: options.guildId ?? "guild", member: { user: { id: "user" }, roles: ["unverified"] },
    data: { custom_id: "x-auth-start", component_type: 2 } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const pending: Promise<unknown>[] = [];
  const response = await discordApp.fetch(new Request("https://example.com/interactions", {
    method: "POST", body, headers: { "content-type": "application/json", "x-signature-timestamp": timestamp,
      "x-signature-ed25519": sign(null, Buffer.from(timestamp + body), keys.privateKey).toString("hex") },
  }), env as unknown as Env, { waitUntil(p: Promise<unknown>) { pending.push(p); } } as ExecutionContext);
  const ack = await response.json();
  await Promise.all(pending);
  return { ack, calls, writes, roles };
}

test("returning verified member gets roles restored without another OAuth or database write", async (t) => {
  const r = await click(t);
  assert.deepEqual(r.ack, { type: 5, data: { flags: 64 } });
  assert.deepEqual(r.calls.map(c => c.method), ["PUT", "DELETE", "PATCH"]);
  assert.deepEqual([...r.roles], ["member"]);
  assert.deepEqual(r.writes, []);
  assert.match(String(r.calls.at(-1)?.body.content), /已恢复 Member/);
});

test("grant failure preserves Unverified and reports a retryable error", async (t) => {
  const r = await click(t, { grantStatus: 403 });
  assert.deepEqual(r.calls.map(c => c.method), ["PUT", "PATCH"]);
  assert.deepEqual([...r.roles], ["unverified"]);
  assert.match(String(r.calls.at(-1)?.body.content), /发放失败/);
});

test("cleanup failure does not claim complete success", async (t) => {
  const r = await click(t, { removeStatus: 403 });
  assert.match(String(r.calls.at(-1)?.body.content), /Unverified 移除失败/);
});

test("network failure reports an error after acknowledgement", async (t) => {
  const r = await click(t, { networkError: true });
  assert.match(String(r.calls.at(-1)?.body.content), /验证处理失败/);
});

test("new member still receives an OAuth link without being granted roles", async (t) => {
  const r = await click(t, { existing: false });
  assert.deepEqual(r.calls.map(c => c.method), ["PATCH"]);
  assert.equal(r.writes.length, 1);
  assert.match(JSON.stringify(r.calls[0]?.body.components), /x.com\/i\/oauth2\/authorize/);
});

test("another guild cannot restore roles", async (t) => {
  const r = await click(t, { guildId: "other" });
  assert.equal(r.ack.type, 4);
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.writes, []);
});
