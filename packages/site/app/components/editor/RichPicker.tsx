import { Popover } from "@base-ui-components/react/popover";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { twJoin } from "tailwind-merge";
import type { CacheManager } from "~/util/cache/CacheManager";
import { randomString } from "~/util/text";
import { popoverStyles } from "../pickers/Popover";
import { EmojiPicker } from "./EmojiPicker";
import { MentionsPicker } from "./MentionsPicker";
import { TimePicker } from "./TimePicker";

// Do we want a gif picker too?
type Tab = "mentions" | "time" | "emoji";

export interface PopoutRichPickerState {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tab: Tab;
  setTab: React.Dispatch<React.SetStateAction<Tab>>;
  openWithTab: (tab: Tab) => void;
}

export const PopoutRichPicker: React.FC<
  React.PropsWithChildren<{
    t?: TFunction;
    insertText: (text: string) => void;
    cache?: CacheManager;
    mentionsTab?: boolean;
    timeTab?: boolean;
    emojiTab?: boolean;
    setState?: React.Dispatch<
      React.SetStateAction<PopoutRichPickerState | undefined>
    >;
  }>
> = ({
  t,
  insertText,
  cache,
  children,
  mentionsTab,
  timeTab,
  emojiTab,
  setState,
}) => {
  const id = randomString(10);
  const [open, setOpen] = useState(false);

  const [tab, setTab] = useState<Tab>(
    mentionsTab === false ? (timeTab === false ? "emoji" : "time") : "mentions",
  );

  useEffect(() => {
    if (setState) {
      setState({
        open,
        setOpen,
        tab,
        setTab,
        openWithTab: (tab: Tab) => {
          setTab(tab);
          setOpen(true);
        },
      });
    }
  }, [setState, tab, open]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="flex marker:hidden marker-none text-start">
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} className="z-[35]">
          <Popover.Popup className={popoverStyles.popup}>
            <div className="bg-gray-300 dark:bg-gray-800 border border-black/5 dark:border-gray-200/20 rounded-lg shadow-md w-[385px]">
              <div className="font-semibold space-x-1 rtl:space-x-reverse px-2 pt-2 text-sm">
                {mentionsTab !== false && (
                  <button
                    type="button"
                    className={twJoin(
                      "inline-block rounded px-1.5 py-px hover:bg-primary-300 dark:hover:bg-primary-500 transition",
                      tab === "mentions"
                        ? "bg-primary-300 dark:bg-primary-500"
                        : "",
                    )}
                    onClick={() => setTab("mentions")}
                  >
                    {t?.("mentions") ?? "Mentions"}
                  </button>
                )}
                {timeTab !== false && (
                  <button
                    type="button"
                    className={twJoin(
                      "inline-block rounded px-1.5 py-px hover:bg-primary-300 dark:hover:bg-primary-500 transition",
                      tab === "time"
                        ? "bg-primary-300 dark:bg-primary-500"
                        : "",
                    )}
                    onClick={() => setTab("time")}
                  >
                    {t?.("timeText") ?? "Time"}
                  </button>
                )}
                {emojiTab !== false && (
                  <button
                    type="button"
                    className={twJoin(
                      "inline-block rounded px-1.5 py-px hover:bg-primary-300 dark:hover:bg-primary-500 transition",
                      tab === "emoji"
                        ? "bg-primary-300 dark:bg-primary-500"
                        : "",
                    )}
                    onClick={() => setTab("emoji")}
                  >
                    {t?.("emojis") ?? "Emojis"}
                  </button>
                )}
              </div>
              {tab === "mentions" && mentionsTab !== false ? (
                <MentionsPicker
                  id={id}
                  className="border-none shadow-none w-full"
                  cache={cache}
                  onMentionClick={(mention, event) => {
                    insertText(
                      mention.scope === "literal"
                        ? mention.id
                        : `<${
                            mention.scope === "special"
                              ? "id:"
                              : mention.scope === "channel"
                                ? "#"
                                : mention.scope === "member"
                                  ? "@"
                                  : mention.scope === "role"
                                    ? "@&"
                                    : ""
                          }${mention.id}>${event.shiftKey ? "" : " "}`,
                    );
                    if (!event.shiftKey) {
                      setOpen(false);
                    }
                  }}
                />
              ) : tab === "time" && timeTab !== false ? (
                <TimePicker
                  id={id}
                  className="border-none shadow-none w-full"
                  // I'm not sure this one needs to be shift-clickable
                  // but we might patch that in later for consistency
                  onTimeClick={(timestamp) => {
                    insertText(
                      `<t:${timestamp.date.unix()}${
                        timestamp.style ? `:${timestamp.style}` : ""
                      }>`,
                    );
                    setOpen(false);
                  }}
                />
              ) : tab === "emoji" && emojiTab !== false ? (
                <EmojiPicker
                  id={id}
                  cache={cache}
                  className="border-none shadow-none w-full"
                  customEmojis={cache ? cache.emoji.getAll() : []}
                  onEmojiClick={(emoji, event) => {
                    insertText(
                      (emoji.keywords.includes("discord")
                        ? `<${emoji.keywords.includes("animated") ? "a" : ""}:${
                            emoji.name
                          }:${emoji.skin.native}>`
                        : emoji.skin.native) + (event.shiftKey ? "" : " "),
                    );
                    if (!event.shiftKey) {
                      setOpen(false);
                    }
                  }}
                />
              ) : (
                <></>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
};
