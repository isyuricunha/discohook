import { APIWebhook } from "discord-api-types/v10";
import { QueryData } from "~/types/QueryData";
import { PartialResource } from "~/types/Resources";
import { cdn } from "~/util/discord";
import { Embed } from "./Embed";
import { Markdown } from "./Markdown";

export const Message: React.FC<{
  message: QueryData["messages"][number]["data"];
  webhook?: APIWebhook;
  compact?: boolean;
  date?: Date;
  resolved?: Record<string, PartialResource>;
}> = ({ message, webhook, date, resolved }) => {
  const username = message.author?.name ?? webhook?.name ?? "Boogiehook",
    avatarUrl =
      message.author?.icon_url ??
      (webhook?.avatar
        ? cdn.avatar(webhook.id, webhook.avatar, { size: 64 })
        : cdn.defaultAvatar(5)),
    badge: string | undefined = "BOT";

  return (
    <div className="flex">
      <div className="hidden sm:block w-fit shrink-0">
        <img
          className="rounded-full mr-3 h-10 w-10 cursor-pointer hover:shadow-lg active:translate-y-px"
          src={avatarUrl}
          alt={username}
        />
      </div>
      <div className="grow">
        <p className="leading-none h-4">
          <span className="hover:underline cursor-pointer underline-offset-1 decoration-1 font-semibold">{username}</span>
          {badge && (
            <span className="font-medium ml-1 mt-[0.75px] text-[10px] rounded px-1.5 py-px bg-blurple text-white items-center inline-flex h-4">{badge}</span>
          )}
          <span className="font-medium ml-1 cursor-default text-xs align-baseline text-[#5C5E66] dark:text-[#949BA4]">
            Today at {(date ?? new Date()).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </span>
        </p>
        {message.content && (
          <div className="font-medium text-base leading-[1.375] whitespace-pre-wrap break-words">
            <Markdown text={message.content} features="all" resolved={resolved} />
          </div>
        )}
        {message.embeds && message.embeds.length > 0 && (
          <div className="space-y-1 mt-1">
            {message.embeds.map((embed, i) => (
              <Embed key={`message-preview-embed-${i}`} embed={embed} resolved={resolved} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
