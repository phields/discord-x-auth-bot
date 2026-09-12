import { OAuthError } from "./x-oauth";

/** Reapply roles from a verified binding, including after a member rejoins. */
export async function syncVerifiedRoles(env: Env, guildId: string, userId: string): Promise<void> {
  if (guildId !== env.DISCORD_GUILD_ID) throw new OAuthError("服务器不匹配。", 400);
  const base = `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles`;
  const headers = {
    authorization: `Bot ${env.DISCORD_TOKEN}`,
    "x-audit-log-reason": encodeURIComponent("Restore roles from verified X binding"),
  };
  // Only remove Unverified after Discord confirms that Member was granted.
  for (const [method, roleId] of [
    ["PUT", env.DISCORD_VERIFIED],
    ["DELETE", env.DISCORD_UNVERIFIED],
  ] as const) {
    const response = await fetch(`${base}/${roleId}`, {
      method, headers, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(JSON.stringify({
        event: method === "PUT" ? "discord_role_grant_failed" : "discord_unverified_role_remove_failed",
        status: response.status, userId, roleId,
      }));
      throw new OAuthError(method === "PUT"
        ? "X 绑定已保留，但身份组发放失败，请再次点击验证按钮重试；若仍失败请联系管理员。"
        : "Member 身份组已发放，但 Unverified 移除失败，请再次点击验证按钮重试或联系管理员。", 502);
    }
  }
}
