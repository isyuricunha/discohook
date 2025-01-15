import { REST } from "@discordjs/rest";
import { json } from "@remix-run/cloudflare";
import { Link, useLoaderData, useSubmit } from "@remix-run/react";
import { APIUser, ButtonStyle, Routes } from "discord-api-types/v10";
import { useTranslation } from "react-i18next";
import { twMerge } from "tailwind-merge";
import { z } from "zod";
import { getDiscordUserOAuth } from "~/auth-discord.server";
import { Button } from "~/components/Button";
import { linkClassName } from "~/components/preview/Markdown";
import { TabHeader } from "~/components/tabs";
import { getBucket } from "~/durable/rate-limits";
import { getUser } from "~/session.server";
import { discordUsers, eq, getDb, users } from "~/store.server";
import { getId } from "~/util/id";
import { LoaderArgs } from "~/util/loader";
import { getUserAvatar, getUserTag } from "~/util/users";
import { zxParseForm } from "~/util/zod";

export const loader = async ({ request, context }: LoaderArgs) => {
  const user = await getUser(request, context, true);
  return { user };
};

export const action = async ({ request, context }: LoaderArgs) => {
  const user = await getUser(request, context, true);
  const { action } = await zxParseForm(request, {
    action: z.literal("refresh"),
  });

  switch (action) {
    case "refresh": {
      const headers = await getBucket(request, context, "profileRefresh");
      if (!user.discordId) return new Response(null, { headers });

      const db = getDb(context.env.HYPERDRIVE);
      const oauth = await getDiscordUserOAuth(db, context.env, user.discordId);
      let discordUser: APIUser;
      if (oauth) {
        const rest = new REST({ authPrefix: "Bearer" }).setToken(
          oauth.accessToken,
        );
        discordUser = (await rest.get(Routes.user())) as APIUser;
      } else {
        const rest = new REST().setToken(context.env.DISCORD_BOT_TOKEN);
        discordUser = (await rest.get(
          Routes.user(user.discordId.toString()),
        )) as APIUser;
      }

      const updated = await db.transaction(async (tx) => {
        await tx
          .update(discordUsers)
          .set({
            name: discordUser.username,
            globalName: discordUser.global_name,
            discriminator: discordUser.discriminator,
            avatar: discordUser.avatar,
          })
          .where(eq(discordUsers.id, BigInt(discordUser.id)));

        const [updated] = await tx
          .update(users)
          .set({ name: discordUser.global_name ?? discordUser.username })
          .where(eq(users.id, user.id))
          .returning({
            id: users.id,
            name: users.name,
            discordId: users.discordId,
          });
        return updated;
      });
      return json(updated, { headers });
    }
    default:
      break;
  }

  return null;
};

export default () => {
  const { t } = useTranslation();
  const { user } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  return (
    <div>
      <TabHeader>{t("profile")}</TabHeader>
      <div className="w-full rounded-lg bg-gray-200 dark:bg-gray-900 shadow-md p-4">
        <div className="flex">
          <img
            className="rounded-full ltr:mr-4 rtl:ml-4 h-[4.5rem] w-[4.5rem] my-auto"
            src={getUserAvatar(user, { size: 128 })}
            alt={user.name}
          />
          <div className="grow my-auto">
            <p className="text-2xl font-semibold leading-none dark:text-gray-100">
              {user.name}
            </p>
            <span className="text-base font-medium dark:text-gray-400">
              {getUserTag(user)}
            </span>
          </div>
          <div className="ltr:ml-auto rtl:mr-auto grid mb-auto gap-2 w-fit">
            <Link to="/auth/logout" className="block">
              <Button discordstyle={ButtonStyle.Secondary}>
                {t("logOut")}
              </Button>
            </Link>
            <Button
              discordstyle={ButtonStyle.Primary}
              onClick={() => submit({ action: "refresh" }, { method: "POST" })}
            >
              {t("refresh")}
            </Button>
          </div>
        </div>
        <div className="space-y-4 mt-4 rounded-lg p-4 bg-gray-400 dark:bg-gray-800">
          <div>
            <p className="uppercase font-bold text-sm leading-4 dark:text-gray-400">
              {t("subscribedSince")}
            </p>
            <p className="text-base font-normal">
              {user.subscribedSince ? (
                t("timestamp.date_verbose", {
                  replace: { date: new Date(user.subscribedSince) },
                })
              ) : (
                <Link
                  to="/donate"
                  className={twMerge(
                    linkClassName,
                    "text-brand-pink dark:text-brand-pink",
                  )}
                >
                  {t("notSubscribed")}
                </Link>
              )}
              {user.lifetime ? ` (${t("lifetime")}!)` : ""}
            </p>
          </div>
          <div>
            <p className="uppercase font-bold text-sm leading-4 dark:text-gray-400">
              {t("firstSubscribed")}
            </p>
            <p className="text-base font-normal">
              {user.firstSubscribed
                ? t("timestamp.date_verbose", {
                    replace: { date: new Date(user.firstSubscribed) },
                  })
                : t("never")}
            </p>
          </div>
          <div>
            <p className="uppercase font-bold text-sm leading-4 dark:text-gray-400">
              {t("joinedDiscohook")}
            </p>
            <p className="text-base font-normal">
              {t("timestamp.date_verbose", {
                replace: { date: new Date(getId(user).timestamp) },
              })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
