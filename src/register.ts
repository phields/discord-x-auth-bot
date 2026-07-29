import { Command, Option, register } from "discord-hono";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const commands = [
  new Command("verify-panel", "发布 X OAuth 新人验证面板")
    .default_member_permissions("32"),
  new Command("xauth-status", "查询指定 Discord 用户的 X 授权状态")
    .options(new Option("user", "要查询的 Discord 用户", "User").required())
    .default_member_permissions("32"),
];

await register(
  commands,
  required("DISCORD_APPID"),
  required("DISCORD_TOKEN"),
  process.env.DISCORD_GUILD_ID,
);
