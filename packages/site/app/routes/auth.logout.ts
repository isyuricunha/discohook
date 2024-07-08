import { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { getDiscordAuth } from "~/.server/auth-discord";

export const loader = ({ request, context }: LoaderFunctionArgs) =>
  getDiscordAuth(context).logout(request, { redirectTo: "/" });
