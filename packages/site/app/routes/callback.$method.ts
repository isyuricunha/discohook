import { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { z } from "zod";
import { getDiscordAuth } from "~/.server/auth-discord";
import { getGuildedAuth } from "~/.server/auth-guilded";
import { getSessionStorage } from "~/.server/session";
import { zxParseParams } from "~/util/zod";

export const loader = async ({
  request,
  context,
  params,
}: LoaderFunctionArgs) => {
  const { method } = zxParseParams(params, {
    method: z.enum(["discord", "guilded"]),
  });

  const { sessionStorage, getSession } = getSessionStorage(context);
  const session = await getSession(request.headers.get("Cookie"));
  const auth =
    method === "discord"
      ? getDiscordAuth(context, sessionStorage)
      : getGuildedAuth(context, sessionStorage);

  const redirectTo: string | null = session.get("redirectTo") || null;
  return await auth.authenticate(method, request, {
    successRedirect: redirectTo ?? "/?m=auth-success",
    failureRedirect: "/?m=auth-failure",
  });
};
