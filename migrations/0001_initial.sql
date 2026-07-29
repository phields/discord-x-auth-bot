CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX oauth_states_expiry_idx ON oauth_states (expires_at);

CREATE TABLE x_auth (
  discord_user_id TEXT PRIMARY KEY,
  x_user_id TEXT NOT NULL UNIQUE,
  x_username TEXT NOT NULL,
  authorized_at TEXT NOT NULL
);
