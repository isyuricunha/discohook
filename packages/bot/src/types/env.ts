export interface Env {
  ENVIRONMENT: "dev" | "production";
  PREMIUM_SKUS: string[];
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_TOKEN: string;
  DEVELOPMENT_SERVER_ID: string;
  DISCOHOOK_ORIGIN: string;
  TOKEN_SECRET: string;
  WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE?: string;
  HYPERDRIVE: Hyperdrive;
  KV: KVNamespace;
  COMPONENTS: DurableObjectNamespace;
}
