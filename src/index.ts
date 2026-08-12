import { Hono } from "hono";
import { discordApp } from "./discord";
import { completeXOAuth, OAuthError } from "./x-oauth";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.json({ service: "discord-auth-bot", status: "ok" }));
app.get("/health", (c) => c.text("ok"));

app.get("/oauth/x/callback", async (c) => {
  const error = c.req.query("error");
  if (error) return c.text(`X 授权已取消：${error}`, 400);
  const state = c.req.query("state");
  const code = c.req.query("code");
  if (!state || !code) return c.text("缺少 OAuth 回调参数。", 400);

  const verification = finishVerification(c.env, state, code);
  c.executionCtx.waitUntil(verification.then(
    () => undefined,
    (error: unknown) => {
      if (!(error instanceof OAuthError)) {
        console.error(JSON.stringify({ event: "oauth_background_failed", error: String(error) }));
      }
    },
  ));

  try {
    const result = await verification;
    return c.html(`<main><h1>验证成功</h1><p>X 账号 @${escapeHtml(result.username)} 已绑定，可以关闭页面。</p></main>`);
  } catch (error) {
    if (error instanceof OAuthError) return c.text(error.message, error.status);
    console.error(JSON.stringify({ event: "oauth_callback_failed", error: String(error) }));
    return c.text("验证失败，请重新发起或联系管理员。", 500);
  }
});

async function finishVerification(env: Env, state: string, code: string): Promise<{ username: string }> {
  const result = await completeXOAuth(env, state, code);
  if (result.guildId !== env.DISCORD_GUILD_ID) throw new OAuthError("服务器不匹配。", 400);
  const roleResponse = await fetch(
      `https://discord.com/api/v10/guilds/${result.guildId}/members/${result.discordUserId}/roles/${env.DISCORD_VERIFIED}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bot ${env.DISCORD_TOKEN}`,
          "content-type": "application/json",
          "x-audit-log-reason": encodeURIComponent("X OAuth verification completed"),
        },
      },
  );
  if (!roleResponse.ok) {
    const responseBody = await roleResponse.text();
    console.error(JSON.stringify({
      event: "discord_role_grant_failed",
      status: roleResponse.status,
      userId: result.discordUserId,
      roleId: env.DISCORD_VERIFIED,
      responseBody,
    }));
    throw new OAuthError("X 验证成功，但身份组分配失败，请联系管理员。", 502);
  }
  const removeResponse = await fetch(
      `https://discord.com/api/v10/guilds/${result.guildId}/members/${result.discordUserId}/roles/${env.DISCORD_UNVERIFIED}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bot ${env.DISCORD_TOKEN}`,
          "x-audit-log-reason": encodeURIComponent("X OAuth verification completed"),
        },
      },
  );
  if (!removeResponse.ok && removeResponse.status !== 404) {
    console.warn(JSON.stringify({ event: "discord_unverified_role_remove_failed", status: removeResponse.status, userId: result.discordUserId }));
  }
  return { username: result.username };
}

app.mount("/interactions", discordApp.fetch);

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}

export default app;
