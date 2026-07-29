# 故障排查

## X 授权交换失败

检查：

- X OAuth 2.0 Client ID/Secret 是否来自同一个 App。
- App type 是否为 `Web App, Automated App or Bot`。
- Worker 使用的 `X_REDIRECT_URI` 是否与 X Console 完全一致。
- 重新生成 Client Secret 后，是否已重新执行 `wrangler secret put X_CLIENT_SECRET`。

OAuth authorization code 有效时间很短，失败后需要从 Discord 按钮重新生成授权链接。

## `client-forbidden` / App 尚未获得 X API 访问资格

这不是 OAuth 2.0 不支持。`GET /2/users/me` 支持 OAuth 2.0 Authorization Code + PKCE。

处理：

1. 在 X Apps 页面将 App 从旧 `Free` 项目 Move 到 `Pay Per Use -> Production`。
2. 确认 OAuth 2.0 App permissions 包含 Read，授权 scope 包含 `users.read`。
3. 购买 X API Credits。
4. 使用该 Production App 的 OAuth 2.0 Client ID/Secret，重新发起授权。

## `usage-capped`

X API Credits 已用尽或账户受到 spending limit 限制。在 X Developer Console 充值并检查限额。

## X 验证成功，但角色分配失败

查看 Worker 日志：

```bash
npx wrangler tail
```

### Discord `50013 Missing Permissions`

逐项检查：

- Bot 拥有 `Manage Roles`。
- Discord 服务器的角色顺序中，Bot 角色高于 Member 和 Unverified。
- `DISCORD_VERIFIED` 指向普通角色，而不是 Linked Role/集成角色。托管角色的 Discord API 属性为 `managed: true`，任何 Bot 都无法手动分配。
- Worker 的 `DISCORD_VERIFIED` 和 `DISCORD_UNVERIFIED` 没有写反。

### Discord `50001 Missing Access`

Bot 无法访问目标频道。检查频道/分类的权限覆盖，以及 Bot 是否能查看该频道。

## 用户拿到 Member 但看不到频道

角色成功分配不等于自动获得所有频道权限。在相应频道或分类的 Permissions 中添加 Member，并设置 View Channel/Send Messages 等需要的权限。

## Discord 拒绝 Interactions Endpoint URL

检查：

- URL 是 `https://.../interactions/`。
- Worker 中的 `DISCORD_PUBLIC_KEY` 属于当前 Discord Application。
- Worker 已部署且 `/health` 可访问。
- Cloudflare 路由前没有额外的 Access 登录页或重定向。

## Slash command 不显示

- 确认已执行 `npm run register`。
- `.env` 中的 `DISCORD_APPID`、`DISCORD_TOKEN` 和 `DISCORD_GUILD_ID` 属于同一 Application/服务器。
- Bot 安装 scope 包含 `applications.commands`。
- 命令默认需要“管理服务器”权限；普通成员看不到是预期行为。

## D1 表不存在

对生产 D1 执行：

```bash
npx wrangler d1 migrations apply discord-auth-bot --remote
```

并确认 `wrangler.jsonc` 中的 `database_id` 是当前账号下的 D1 ID。
