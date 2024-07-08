import { ActionFunctionArgs, json } from "@remix-run/cloudflare";
import { z } from "zod";
import { zx } from "zodix";
import { getUserId } from "~/.server/session";
import { getDb, shareLinks } from "~/.server/store";
import { ZodQueryData } from "~/types/QueryData";
import { randomString } from "~/util/text";
import { jsonAsString, zxParseForm } from "~/util/zod";

const ALLOWED_EXTERNAL_ORIGINS = ["https://discohook.org"] as const;

export interface ShortenedData {
  data: string;
  origin?: string;
  userId?: string;
}

export const generateUniqueShortenKey = async (
  kv: KVNamespace,
  length: number,
  tries = 10,
): Promise<{ id: string; key: string }> => {
  for (const _ of Array(tries)) {
    const id = randomString(length);
    const key = `share-${id}`;
    if (!(await kv.get(key))) {
      return { id, key };
    }
  }
  return await generateUniqueShortenKey(kv, length + 1);
};

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const contentLength = Number(request.headers.get("Content-Length"));
  if (!contentLength || Number.isNaN(contentLength)) {
    throw json({ message: "Must provide Content-Length header." }, 400);
  }
  if (contentLength > 25690112) {
    // Just under 24.5 MiB. KV limit for values is 25 MiB
    throw json({ message: "Data is too large (max. ~24 MiB)." });
  }

  const {
    data,
    ttl,
    origin: origin_,
  } = await zxParseForm(request, {
    data: jsonAsString(ZodQueryData),
    // Max 4 weeks, min 5 minutes
    ttl: zx.IntAsString.optional()
      .default("604800000")
      .refine((val) => val >= 300000 && val <= 2419200000),
    origin: z.enum(ALLOWED_EXTERNAL_ORIGINS).optional(),
  });

  const userId = await getUserId(request, context);
  const expires = new Date(new Date().getTime() + ttl);
  const origin = origin_ ?? new URL(request.url).origin;

  // biome-ignore lint/performance/noDelete: We don't want to store this property at all
  delete data.backup_id;
  const shortened: ShortenedData = {
    data: JSON.stringify(data),
    origin,
    userId: userId?.toString(),
  };

  const db = getDb(context.env.HYPERDRIVE);
  const kv = context.env.KV;
  const { id, key } = await generateUniqueShortenKey(kv, 8);
  await kv.put(key, JSON.stringify(shortened), {
    expirationTtl: ttl / 1000,
    // KV doesn't seem to provide a way to read `expirationTtl`
    metadata: { expiresAt: new Date(new Date().valueOf() + ttl).toISOString() },
  });
  if (userId) {
    await db.insert(shareLinks).values({
      userId,
      shareId: id,
      expiresAt: expires,
      origin: origin_,
    });
  }

  return {
    id,
    origin,
    url: `${new URL(request.url).origin}/?share=${id}`,
    expires,
    userId: userId ?? undefined,
  };
};
