import { json } from "@remix-run/cloudflare";
import { z } from "zod";
import { zx } from "zodix";
import { ZodCryptoAlert } from "~/types/crypto";
import { LoaderArgs } from "~/util/loader";

export const action = async ({ request, params, context }: LoaderArgs) => {
  const { token } = zx.parseParams(params, {
    token: z.string(),
  });
  if (
    !context.env.CRYPTO_ALERTS_TOKEN ||
    token !== context.env.CRYPTO_ALERTS_TOKEN
  ) {
    throw json({ message: "Invalid or missing token" }, 400);
  }

  const data = await request.json();
  const payload = ZodCryptoAlert.parse(data);

  switch (payload.type) {
    case "wallet": {
      // Calculate exchange rate
      // 
      break;
    }
    default:
      break;
  }

  return null;
};