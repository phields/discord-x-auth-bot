import { Button, Components, DiscordHono } from "discord-hono";
import { createAuthorizationUrl, OAuthError } from "./x-oauth";
import { syncVerifiedRoles } from "./discord-roles";
import type { DiscordEnv, XAuthRecord } from "./types";

const EPHEMERAL = 1 << 6;
const MANAGE_GUILD = 1n << 5n;

function isAdmin(permissions?: string): boolean {
  return permissions !== undefined && (BigInt(permissions) & MANAGE_GUILD) === MANAGE_GUILD;
}

export const discordApp = new DiscordHono<DiscordEnv>({
  discordEnv: (env) => {
    if (!env) throw new Error("Cloudflare bindings are unavailable");
    return {
      APPLICATION_ID: env.DISCORD_APPID,
      PUBLIC_KEY: env.DISCORD_PUBLIC_KEY,
      TOKEN: env.DISCORD_TOKEN,
    };
  },
})
  .command("verify-panel", (c) => {
    if (!isAdmin(c.interaction.member?.permissions)) {
      return c.res({ content: "只有服务器管理员可以发布验证面板。", flags: EPHEMERAL });
    }
    if (c.interaction.channel_id !== c.env.DISCORD_CHANNEL_ID) {
      return c.res({
        content: `请在 <#${c.env.DISCORD_CHANNEL_ID}> 中发布验证面板。`,
        flags: EPHEMERAL,
      });
    }
    return c.res({
      embeds: [{
        title: "新人验证",
        description: "点击下方按钮，通过 X OAuth 验证后获得 Member Role。",
        color: 0x5865f2,
      }],
      components: new Components().row(new Button("x-auth-start", "使用 X 验证", "Primary")),
    });
  })
  .component("x-auth-start", async (c) => {
    const userId = c.interaction.member?.user.id;
    const guildId = c.interaction.guild_id;
    if (!userId || !guildId || guildId !== c.env.DISCORD_GUILD_ID) {
      return c.res({ content: "请在指定服务器内使用此验证按钮。", flags: EPHEMERAL });
    }
    return c.flags("EPHEMERAL").resDefer(async (c) => {
      try {
        const existing = await c.env.DB.prepare(
          "SELECT x_username FROM x_auth WHERE discord_user_id = ?1",
        ).bind(userId).first<{ x_username: string }>();
        if (existing) {
          await syncVerifiedRoles(c.env, guildId, userId);
          await c.followup({
            content: `你已经绑定 X：@${existing.x_username}，已恢复 Member 身份组，无需重新授权。`,
            allowed_mentions: { parse: [] },
          });
          return;
        }
        const url = await createAuthorizationUrl(c.env, userId, guildId);
        await c.followup({
          content: "授权链接 2 小时内有效。完成后将自动获得 Member Role。",
          components: new Components().row(new Button(url, "前往 X 授权", "Link")),
        });
      } catch (error) {
        console.error(JSON.stringify({ event: "x_auth_start_failed", userId, guildId, expected: error instanceof OAuthError }));
        await c.followup(error instanceof OAuthError ? error.message : "验证处理失败，请再次点击按钮重试或联系管理员。");
      }
    });
  })
  .command("xauth-status", async (c) => {
    if (!isAdmin(c.interaction.member?.permissions)) {
      return c.res({ content: "只有服务器管理员可以查询授权记录。", flags: EPHEMERAL });
    }
    const userId = c.var.user;
    if (!userId) return c.res({ content: "缺少 user 参数。", flags: EPHEMERAL });
    const record = await c.env.DB.prepare(
      "SELECT discord_user_id, x_user_id, x_username, authorized_at FROM x_auth WHERE discord_user_id = ?1",
    ).bind(userId).first<XAuthRecord>();
    if (!record) return c.res({ content: `<@${userId}> 尚未完成 X OAuth。`, flags: EPHEMERAL });
    return c.res({
      content: [
        `<@${userId}> 已完成 X OAuth`,
        `X：[@${record.x_username}](https://x.com/${record.x_username})`,
        `X User ID：\`${record.x_user_id}\``,
        `授权时间：\`${record.authorized_at}\``,
      ].join("\n"),
      flags: EPHEMERAL,
    });
  });
