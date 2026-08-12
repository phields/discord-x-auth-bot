# Discord X Auth Bot

一个可自行部署的 Discord 新人 X OAuth 验证机器人，基于 TypeScript、[discord-hono](https://github.com/luisfun/discord-hono)、Hono、Cloudflare Workers 和 D1。

## 功能

- 在 Discord 验证频道发布 X 授权按钮。
- 使用 OAuth 2.0 Authorization Code + PKCE 获取当前 X 用户资料。
- 验证成功后添加 `Member` 类普通角色，并移除 `Unverified` 角色。
- 使用 D1 保存 Discord 与 X 账号映射，不保存 X access token。
- `/xauth-status user:@成员` 供拥有“管理服务器”权限的管理员查询。
- OAuth state 一次性使用，默认 2 小时过期；回调处理会注册为后台任务，浏览器提前断开也不会中止验证。

> 这是一个 HTTP Interactions Worker，不连接 Discord Gateway，不需要 Privileged Gateway Intents。Discord 账号年龄检查、Wick 和 quarantine 流程不包含在本仓库中。

## 需要准备

- Node.js 22 或更高版本。
- 开启 Workers 和 D1 的 Cloudflare 账号。
- 一个 Discord Application/Bot，以及服务器管理权限。
- 一个 X Developer App，位于 `Pay Per Use -> Production`，并有可用 Credits。

## 1. 安装

```bash
npm ci
cp .env.example .env
```

`.env` 已被 Git 忽略。不要将它提交或发给其他人。

Cloudflare 认证可以二选一：

```bash
npx wrangler login
```

或者在 `.env` 中填入仅限必要权限的 `CLOUDFLARE_API_TOKEN`。

## 2. 配置 Discord

1. 在 [Discord Developer Portal](https://discord.com/developers/applications) 创建 Application 和 Bot。
2. 保存 Application ID、Public Key 和 Bot Token。
3. 在 OAuth2/Installation 中使用 `bot` 和 `applications.commands` scopes 安装到服务器。
4. Bot 只需要 `Manage Roles` 和 `View Channels`；不需要 Administrator。对应基础权限整数为 `268436480`。
5. 创建两个普通服务器角色：验证成功角色（如 `Member`）和待验证角色（如 `Unverified`）。
6. 将 Bot 角色拖到这两个角色上方。
7. 开启 Discord 开发者模式，复制 Guild ID、验证频道 ID 和两个角色 ID。

`DISCORD_VERIFIED` 必须是验证后“添加”的普通角色，`DISCORD_UNVERIFIED` 是验证后“移除”的角色。不要使用 Discord Linked Roles 或其他显示为 `managed: true` 的集成角色。

将非敏感 ID 写入 `wrangler.jsonc` 的 `vars`：

```jsonc
"DISCORD_GUILD_ID": "YOUR_DISCORD_GUILD_ID",
"DISCORD_CHANNEL_ID": "YOUR_VERIFY_CHANNEL_ID",
"DISCORD_VERIFIED": "YOUR_MEMBER_ROLE_ID",
"DISCORD_UNVERIFIED": "YOUR_UNVERIFIED_ROLE_ID"
```

同时将 Discord Application ID、Token 和 Guild ID 填入 `.env`，用于注册 slash commands。

## 3. 创建 D1

```bash
npx wrangler d1 create discord-auth-bot
```

将返回的 `database_id` 写入 `wrangler.jsonc`，然后执行：

```bash
npx wrangler d1 migrations apply discord-auth-bot --remote
```

## 4. 首次部署并获取 Worker URL

确认 `wrangler.jsonc` 中所有 `YOUR_...` 已替换：

```bash
npm run check
npm run deploy
```

记下 Wrangler 输出的 URL，例如：

```text
https://discord-auth-bot.example.workers.dev
```

## 5. 配置 X OAuth 2.0

1. 在 X Developer Console 中使用 `Pay Per Use -> Production` 下的 App。
2. App permissions 选择 `Read`。
3. Type of App 选择 `Web App, Automated App or Bot`（Confidential client）。
4. Callback/Redirect URL 必须精确填写：

   ```text
   https://YOUR-WORKER.workers.dev/oauth/x/callback
   ```

5. Website URL 可填 Worker 根 URL。
6. 保存 OAuth 2.0 Client ID 和 Client Secret。这不是 OAuth 1.0 API Key/Secret，也不是 App-Only Bearer Token。
7. 购买少量 X API Credits；`GET /2/users/me` 是计费的 User Read。

## 6. 上传 Worker Secrets

使用 Wrangler 交互式输入，不要把密钥写入 `wrangler.jsonc`：

```bash
npx wrangler secret put DISCORD_APPID
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put X_CLIENT_ID
npx wrangler secret put X_CLIENT_SECRET
npx wrangler secret put X_REDIRECT_URI
npm run deploy
```

`X_REDIRECT_URI` 必须与 X Console 中的 Callback URL 完全一致。

## 7. 连接 Discord Interactions

1. 在 Discord Developer Portal 的 General Information 中，将 Interactions Endpoint URL 设为：

   ```text
   https://YOUR-WORKER.workers.dev/interactions/
   ```

2. 确保 `.env` 中已填写 `DISCORD_APPID`、`DISCORD_TOKEN` 和 `DISCORD_GUILD_ID`，然后注册命令：

   ```bash
   npm run register
   ```

3. 在指定验证频道执行 `/verify-panel`。

`/verify-panel` 和 `/xauth-status` 默认只对拥有 `Manage Guild`（管理服务器，权限值 `32`）的成员开放。

## 8. 验证

```bash
curl https://YOUR-WORKER.workers.dev/health
```

应返回 `ok`。然后用一个测试 Discord/X 账号走完验证，确认：

- D1 产生账号映射。
- 用户获得 Member 角色。
- Unverified 角色被移除。
- Member 角色已配置所需频道的访问权限。

## 运维命令

```bash
npm run check
npm run dev
npm run deploy
npm run register
npx wrangler tail
```

更多问题见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)。

## 安全说明

- 不要在聊天、Issue、日志或仓库中粘贴 Bot Token、X Client Secret 或 Cloudflare API Token。
- 已泄露的密钥应立即重新生成并更新 Worker Secret。
- Bot 不需要 Administrator；使用最小权限。
- D1 中不保存 X access token，只保存 Discord ID、X ID、X username 和授权时间。
