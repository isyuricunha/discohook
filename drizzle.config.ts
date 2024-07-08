import dotenv from "dotenv";
import type { Config } from "drizzle-kit";
import process from "node:process";

dotenv.config({ path: "./packages/bot/.dev.vars" });

if (!process.env.WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE) {
  throw Error("Must provide WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE in packages/bot/.dev.vars");
}

export default {
  schema: [
    "./packages/store/src/schema/schema.ts",
    "./packages/store/src/schema/schema-v1.ts",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE,
  },
} satisfies Config;
