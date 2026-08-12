import { pkceChallenge, randomUrlSafe } from "./crypto";
import type { OAuthState } from "./types";

const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const X_ME_URL = "https://api.x.com/2/users/me";
const DEFAULT_OAUTH_STATE_TTL_SECONDS = 7200;

type XTokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};
type XMeResponse = {
  data?: { id: string; username: string };
  title?: string;
  detail?: string;
  type?: string;
  reason?: string;
  required_enrollment?: string;
  registration_url?: string;
  errors?: Array<{ code?: number; message?: string }>;
};

export async function createAuthorizationUrl(
  env: Env,
  discordUserId: string,
  guildId: string,
): Promise<string> {
  const state = randomUrlSafe();
  const verifier = randomUrlSafe(64);
  const challenge = await pkceChallenge(verifier);
  const now = Math.floor(Date.now() / 1000);
  const configuredTtl = Number.parseInt(env.OAUTH_STATE_TTL_SECONDS, 10);
  const ttl = Number.isFinite(configuredTtl) && configuredTtl > 0
    ? configuredTtl
    : DEFAULT_OAUTH_STATE_TTL_SECONDS;

  await env.DB.prepare(
    "INSERT INTO oauth_states (state, discord_user_id, guild_id, code_verifier, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  ).bind(state, discordUserId, guildId, verifier, now + ttl).run();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.X_CLIENT_ID,
    redirect_uri: env.X_REDIRECT_URI,
    scope: "tweet.read users.read",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${X_AUTHORIZE_URL}?${params}`;
}

export async function completeXOAuth(
  env: Env,
  state: string,
  code: string,
): Promise<{ discordUserId: string; guildId: string; username: string }> {
  const now = Math.floor(Date.now() / 1000);
  const record = await env.DB.prepare(
    "SELECT discord_user_id, guild_id, code_verifier, expires_at, used_at FROM oauth_states WHERE state = ?1",
  ).bind(state).first<OAuthState>();
  if (!record) {
    console.warn(JSON.stringify({ event: "oauth_state_invalid" }));
    throw new OAuthError("授权链接无效，请返回 Discord 重新发起验证。", 400);
  }
  if (record.used_at !== null) {
    console.warn(JSON.stringify({ event: "oauth_state_already_used" }));
    throw new OAuthError("该授权链接已经使用，请返回 Discord 重新发起验证。", 409);
  }
  if (record.expires_at < now) {
    console.warn(JSON.stringify({
      event: "oauth_state_expired",
      expiredSecondsAgo: now - record.expires_at,
    }));
    throw new OAuthError("授权链接已过期，请返回 Discord 重新点击“使用 X 验证”。", 400);
  }

  const consumed = await env.DB.prepare(
    "UPDATE oauth_states SET used_at = ?1 WHERE state = ?2 AND used_at IS NULL",
  ).bind(now, state).run();
  if (consumed.meta.changes !== 1) throw new OAuthError("该授权链接已经使用。", 409);

  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: env.X_REDIRECT_URI,
    code_verifier: record.code_verifier,
  });
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  if (env.X_CLIENT_SECRET) {
    headers.set("authorization", `Basic ${btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)}`);
  } else {
    body.set("client_id", env.X_CLIENT_ID);
  }

  const tokenResponse = await fetch(X_TOKEN_URL, { method: "POST", headers, body });
  const token = await tokenResponse.json<XTokenResponse>();
  if (!tokenResponse.ok || !token.access_token) {
    console.error(JSON.stringify({ event: "x_token_exchange_failed", status: tokenResponse.status, error: token.error }));
    throw new OAuthError("X 授权交换失败，请重新发起验证。", 502);
  }

  const meResponse = await fetch(X_ME_URL, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  const me = await meResponse.json<XMeResponse>();
  if (!meResponse.ok || !me.data) {
    console.error(JSON.stringify({
      event: "x_user_lookup_failed",
      status: meResponse.status,
      title: me.title,
      detail: me.detail,
      type: me.type,
      reason: me.reason,
      requiredEnrollment: me.required_enrollment,
      registrationUrl: me.registration_url,
      grantedScopes: token.scope,
      errors: me.errors,
      requestId: meResponse.headers.get("x-request-id"),
    }));
    if (me.type?.endsWith("/client-forbidden")) {
      throw new OAuthError("X 已授权，但该 App 尚未获得 X API 访问资格。请将 App 移入 Pay Per Use 项目并启用 API 计费后重试。", 502);
    }
    if (me.type?.endsWith("/usage-capped")) {
      throw new OAuthError("X 已授权，但 API 额度已用尽。请在 X Developer Console 充值 Credits 后重试。", 502);
    }
    throw new OAuthError(`无法读取 X 用户资料（HTTP ${meResponse.status}）。`, 502);
  }

  const existing = await env.DB.prepare(
    "SELECT discord_user_id FROM x_auth WHERE x_user_id = ?1",
  ).bind(me.data.id).first<{ discord_user_id: string }>();
  if (existing && existing.discord_user_id !== record.discord_user_id) {
    throw new OAuthError("该 X 账号已经绑定到其他 Discord 用户。", 409);
  }

  await env.DB.prepare(
    `INSERT INTO x_auth (discord_user_id, x_user_id, x_username, authorized_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(discord_user_id) DO UPDATE SET
       x_user_id = excluded.x_user_id,
       x_username = excluded.x_username,
       authorized_at = excluded.authorized_at`,
  ).bind(record.discord_user_id, me.data.id, me.data.username, new Date().toISOString()).run();

  return { discordUserId: record.discord_user_id, guildId: record.guild_id, username: me.data.username };
}

export class OAuthError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 502) {
    super(message);
  }
}
