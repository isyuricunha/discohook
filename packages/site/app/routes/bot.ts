import { redirect } from "@remix-run/cloudflare";

export const loader = ({ request, context }: LoaderFunctionArgs) =>
  redirect(
    new URL(
      `https://discord.com/oauth2/authorize?${new URLSearchParams({
        client_id: context.env.DISCORD_CLIENT_ID,
        scope: "bot applications.commands",
        permissions: "0",
        guild_id: new URL(request.url).searchParams.get("guildId") ?? "",
      })}`,
    ).href,
  );
