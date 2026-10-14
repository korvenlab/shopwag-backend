function env(name: string) {
  return process.env[name]?.trim() || "";
}

export const config = {
  port: Number(env("PORT")) || 10000,
  supabaseUrl: env("SUPABASE_URL") || "https://kclhtupbsnflpviausmo.supabase.co",
  supabaseSecretKey: env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY"),
  frontendUrl: (env("FRONTEND_URL") || "http://localhost:3000").replace(/\/$/, ""),
  corsOrigins: (env("CORS_ORIGINS") || env("FRONTEND_URL") || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),
  mp: {
    clientId: env("MP_CLIENT_ID"),
    clientSecret: env("MP_CLIENT_SECRET"),
    redirectUri: env("MP_OAUTH_REDIRECT_URI"),
    webhookUrl: env("MP_WEBHOOK_URL"),
    webhookSecret: env("MP_WEBHOOK_SECRET"),
    tokenSecret: env("MP_TOKEN_SECRET"),
    platformUserId: env("MP_PLATFORM_USER_ID"),
    accessToken: env("MP_ACCESS_TOKEN"),
    oauthTestToken: env("MP_OAUTH_TEST_TOKEN").toLowerCase() === "true",
  },
};

export function mpConfigured() {
  return Boolean(config.mp.clientId && config.mp.clientSecret && config.mp.redirectUri);
}
