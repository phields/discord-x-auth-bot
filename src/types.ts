export type DiscordEnv = {
  Bindings: Env;
  Variables: {
    user?: string;
  };
};

export type OAuthState = {
  discord_user_id: string;
  guild_id: string;
  code_verifier: string;
};

export type XAuthRecord = {
  discord_user_id: string;
  x_user_id: string;
  x_username: string;
  authorized_at: string;
};
