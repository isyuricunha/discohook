import { REST } from "@discordjs/rest";
import {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  defer,
  json,
  redirect,
} from "@remix-run/cloudflare";
import { Link, useLoaderData, useSubmit } from "@remix-run/react";
import {
  APIActionRowComponent,
  APIEmoji,
  APIMessage,
  APIRole,
  APIWebhook,
  ButtonStyle,
  ComponentType,
  RESTPatchAPIWebhookWithTokenMessageJSONBody,
  Routes,
} from "discord-api-types/v10";
import { JWTPayload } from "jose";
import { MouseEventHandler, useEffect, useReducer, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { twJoin } from "tailwind-merge";
import { z } from "zod";
import { getUser, verifyToken } from "~/.server/session";
import {
  StorableComponent,
  discordMessageComponents,
  eq,
  getDb,
  makeSnowflake,
  tokens,
} from "~/.server/store";
import { BRoutes, apiUrl } from "~/api/routing";
import { loader as ApiGetGuildWebhookToken } from "~/api/v1/guilds.$guildId.webhooks.$webhookId.token";
import { getComponentId } from "~/api/v1/log.webhooks.$webhookId.$webhookToken.messages.$messageId";
import { Button } from "~/components/Button";
import { useError } from "~/components/Error";
import { Header } from "~/components/Header";
import { Prose } from "~/components/Prose";
import {
  getComponentWidth,
  getRowWidth,
  submitComponent,
} from "~/components/editor/ComponentEditor";
import { CoolIcon, CoolIconsGlyph } from "~/components/icons/CoolIcon";
import { linkClassName } from "~/components/preview/Markdown";
import { Message } from "~/components/preview/Message.client";
import { ComponentEditForm } from "~/modals/ComponentEditModal";
import { EditingFlowData, FlowEditModal } from "~/modals/FlowEditModal";
import { submitMessage } from "~/modals/MessageSendModal";
import { APIMessageActionRowComponent } from "~/types/QueryData";
import {
  ResolutionKey,
  ResolvableAPIEmoji,
  ResolvableAPIRole,
  useCache,
} from "~/util/cache/CacheManager";
import { cdnImgAttributes } from "~/util/discord";
import { useSafeFetcher } from "~/util/loader";
import { useLocalStorage } from "~/util/localstorage";
import { getUserAvatar } from "~/util/users";
import {
  snowflakeAsString,
  zxParseForm,
  zxParseParams,
  zxParseQuery,
} from "~/util/zod";

interface KVComponentEditorState {
  interactionId: string;
  user: {
    id: string;
    name: string;
    avatar: string | null;
  };
  row?: number;
  column?: number;
}

export const loader = async ({
  request,
  context,
  params,
}: LoaderFunctionArgs) => {
  const { id } = zxParseParams(params, { id: snowflakeAsString() });
  const { token: editorToken } = zxParseQuery(request, {
    token: z.ostring(),
  });
  const db = getDb(context.env.HYPERDRIVE);

  const redirectUrl = `/auth/discord?${new URLSearchParams({
    // We're purposely trimming the original request's query because it
    // probably contains the token and nothing else. We don't need that.
    redirect: new URL(request.url).pathname,
  })}`;

  const user = await getUser(request, context);
  let needUserAuth = false;

  let editingMeta: KVComponentEditorState | undefined;
  if (editorToken) {
    // This is kind of weird but it's the best method I could think of to fall
    // back to user auth if the editor token is invalid in any way. This block
    // should always execute exactly one time.
    while (!needUserAuth) {
      let payload: JWTPayload;
      try {
        ({ payload } = await verifyToken(
          editorToken,
          context.env,
          context.origin,
        ));
      } catch {
        needUserAuth = true;
        break;
      }
      if (payload.scp !== "editor") {
        needUserAuth = true;
        break;
      }
      // biome-ignore lint/style/noNonNullAssertion: Checked in verifyToken
      const tokenId = payload.jti!;

      const key = `token-${tokenId}-component-${id}`;
      const cached = await context.env.KV.get<KVComponentEditorState>(
        key,
        "json",
      );
      if (cached) {
        editingMeta = cached;
      } else {
        // Token does not have permission data for this component. At the moment
        // this means the token is expired, since we don't generate multiple
        // permissions for a single token. Additionally, if someone manually
        // transplanted this token onto a different component editor, then it's
        // been leaked and should be deleted anyway.
        await db.delete(tokens).where(eq(tokens.id, makeSnowflake(tokenId)));
        needUserAuth = true;
        break;
      }

      const token = await db.query.tokens.findFirst({
        where: (tokens, { eq }) => eq(tokens.id, makeSnowflake(tokenId)),
        columns: {
          id: true,
          prefix: true,
        },
      });
      if (!token || token.prefix !== payload.scp) {
        needUserAuth = true;
        break;
      }
      break;
    }
  } else if (!user) {
    throw redirect(redirectUrl);
  }

  const component = await db.query.discordMessageComponents.findFirst({
    where: (table, { eq }) => eq(table.id, id),
    columns: {
      id: true,
      data: true,
      draft: true,
      createdById: true,
      guildId: true,
      channelId: true,
      messageId: true,
    },
  });
  if (!component) {
    throw json({ message: "Unknown Component" }, 404);
  }
  if (needUserAuth) {
    if (!user) {
      throw redirect(redirectUrl);
    }
    if (component.createdById !== BigInt(user.id)) {
      throw json(
        { message: "You do not have edit access to this component." },
        403,
      );
    }
  }

  const rest = new REST().setToken(context.env.DISCORD_BOT_TOKEN);
  const message = await (async () => {
    if (component.channelId && component.messageId) {
      let msg: APIMessage | undefined;
      try {
        msg = (await rest.get(
          Routes.channelMessage(
            String(component.channelId),
            String(component.messageId),
          ),
        )) as APIMessage;
      } catch {}

      if (msg) {
        const { resolved, components: rows, webhook_id } = msg;
        return { resolved, components: rows, webhook_id } as Pick<
          APIMessage,
          "resolved" | "components" | "webhook_id"
        >;
      }
    }
  })();

  const emojis = (async () => {
    if (component.guildId) {
      try {
        return (
          (await rest.get(
            Routes.guildEmojis(String(component.guildId)),
          )) as APIEmoji[]
        ).map(
          (emoji) =>
            ({
              id: emoji.id ?? undefined,
              name: emoji.name ?? "",
              animated: emoji.animated,
              available: emoji.available === false ? false : undefined,
            }) as ResolvableAPIEmoji,
        );
      } catch {}
    }
    return [];
  })();

  const roles = (async () => {
    if (component.guildId) {
      try {
        return (
          (await rest.get(
            Routes.guildRoles(String(component.guildId)),
          )) as APIRole[]
        ).map(
          (role) =>
            ({
              id: role.id,
              name: role.name,
              color: role.color,
              managed: role.managed,
              mentionable: role.mentionable,
              position: role.position,
              unicode_emoji: role.unicode_emoji,
              icon: role.icon,
            }) as ResolvableAPIRole,
        );
      } catch {}
    }
    return [];
  })();

  return defer({
    user,
    component,
    token: editorToken,
    editingMeta,
    message,
    emojis,
    roles,
  });
};

export const action = async ({
  request,
  context,
  params,
}: ActionFunctionArgs) => {
  const { id } = zxParseParams(params, { id: snowflakeAsString() });
  const { token, row, column } = await zxParseForm(request, {
    token: z.ostring(),
    row: z.number().min(0).max(4).optional(),
    column: z.number().min(0).max(4).optional(),
  });
  let tokenData: KVComponentEditorState | undefined;
  if (token) {
    if (row === undefined || column === undefined) {
      // This is because users logged in regularly (technically a different
      // sort of flow) are permitted to edit directly from the frontend,
      // saving us a request.
      throw json(
        { message: "`row` and `column` required when using `token`" },
        400,
      );
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await verifyToken(token, context.env, context.origin));
    } catch {
      throw json({ message: "Invalid token" }, 401);
    }
    if (payload.scp !== "editor") {
      throw json({ message: "Invalid token" }, 401);
    }
    // biome-ignore lint/style/noNonNullAssertion: Checked in verifyToken
    const tokenId = payload.jti!;

    const key = `token-${tokenId}-component-${id}`;
    const cached = await context.env.KV.get<KVComponentEditorState>(
      key,
      "json",
    );
    if (!cached) {
      throw json(
        {
          message:
            "Interaction has timed out, log in normally to edit the message.",
        },
        404,
      );
    }
    tokenData = {
      ...cached,
      row,
      column,
    };
    await context.env.KV.put(key, JSON.stringify(tokenData), {
      // 2 hours
      expirationTtl: 7_200,
    });
  }

  const user = await getUser(request, context);

  const db = getDb(context.env.HYPERDRIVE);
  const component = await db.query.discordMessageComponents.findFirst({
    where: (table, { eq }) => eq(table.id, id),
    columns: {
      id: true,
      data: true,
      draft: true,
      // createdById: true,
      // guildId: true,
      channelId: true,
      messageId: true,
    },
  });
  if (!component) {
    throw json({ message: "Unknown Component" }, 404);
  }
  if (!component.channelId || !component.messageId) {
    throw json(
      { message: "Cannot use this route to modify a message-less component" },
      400,
    );
  }

  const rest = new REST().setToken(context.env.DISCORD_BOT_TOKEN);

  let message: APIMessage;
  try {
    message = (await rest.get(
      Routes.channelMessage(
        String(component.channelId),
        String(component.messageId),
      ),
    )) as APIMessage;
  } catch {
    throw json({ message: "Failed to retrieve the message" }, 400);
  }

  let isDraft = component.draft;
  for (const row of message.components ?? []) {
    for (const rowComponent of row.components) {
      if (
        getComponentId(rowComponent) === component.id &&
        rowComponent.type === component.data.type
      ) {
        isDraft = false;
        break;
      }
    }
  }

  const updated = (
    await db
      .update(discordMessageComponents)
      .set({
        draft: isDraft,
      })
      .where(eq(discordMessageComponents.id, id))
      .returning({
        id: discordMessageComponents.id,
        data: discordMessageComponents.data,
        draft: discordMessageComponents.draft,
      })
  )[0];

  if (tokenData && message.webhook_id) {
    const webhook = (await rest.get(
      Routes.webhook(message.webhook_id),
    )) as APIWebhook;
    if (!webhook.token) {
      throw json(
        {
          message:
            "Cannot edit the message because the webhook token is inaccessible.",
        },
        401,
      );
    }

    await rest.patch(
      Routes.webhookMessage(webhook.id, webhook.token, message.id),
      {
        body: {
          components: getRowsWithInsertedComponent(
            message.components ?? [],
            buildStorableComponent(updated.data, String(updated.id)),
            // biome-ignore lint/style/noNonNullAssertion: Non-nullable if token is present
            [row!, column!],
          ),
        } satisfies RESTPatchAPIWebhookWithTokenMessageJSONBody,
      },
    );
  }

  return updated;
};

const buildStorableComponent = (
  component: StorableComponent,
  id: string,
): APIMessageActionRowComponent => {
  switch (component.type) {
    case ComponentType.Button: {
      if (component.style === ButtonStyle.Link) {
        return component;
      }
      return {
        ...component,
        custom_id: `p_${id}`,
      };
    }
    case ComponentType.StringSelect: {
      const {
        minValues: min_values,
        maxValues: max_values,
        ...rest
      } = component;

      return {
        ...rest,
        custom_id: `p_${id}`,
        min_values,
        max_values,
      };
    }
    case ComponentType.UserSelect:
    case ComponentType.RoleSelect:
    case ComponentType.MentionableSelect:
    case ComponentType.ChannelSelect: {
      const {
        minValues: min_values,
        maxValues: max_values,
        defaultValues: default_values,
        ...rest
      } = component;

      return {
        ...rest,
        custom_id: `p_${id}`,
        min_values,
        max_values,
        // @ts-expect-error
        default_values,
      };
    }
    default:
      break;
  }
  throw Error("Unsupported storable component type.");
};

const getRowsWithInsertedComponent = (
  rows: APIActionRowComponent<APIMessageActionRowComponent>[],
  component: APIMessageActionRowComponent,
  position: [number, number],
) =>
  structuredClone(rows).map((row, i) => {
    if (i === position[0]) {
      // We don't want to send this data to Discord
      const cleaned = { ...component };
      if ("flowId" in cleaned) {
        cleaned.flowId = undefined;
      }
      if ("flowIds" in cleaned) {
        cleaned.flowIds = undefined;
      }
      row.components.splice(position[1], 0, cleaned);
    }
    return row;
  });

export default function EditComponentPage() {
  const {
    user,
    component: component_,
    token,
    editingMeta,
    message,
    emojis,
    roles,
  } = useLoaderData<typeof loader>();
  const { t } = useTranslation();
  const [error, setError] = useError(t);
  const cache = useCache(false);
  const submit = useSubmit();

  // biome-ignore lint/correctness/useExhaustiveDependencies: Once! Or whenever `emojis` changes, which would be never right now
  useEffect(() => {
    if (component_.guildId) {
      emojis.then((resolved) =>
        cache.fill(
          ...resolved.map(
            (r) => [`emoji:${r.id}`, r] as [ResolutionKey, ResolvableAPIEmoji],
          ),
        ),
      );
      roles.then((resolved) =>
        cache.fill(
          ...resolved.map(
            (r) => [`role:${r.id}`, r] as [ResolutionKey, ResolvableAPIRole],
          ),
        ),
      );
    }
  }, [emojis, roles]);

  // Temp disabled until we create a session cookie
  // const [params, setParams] = useSearchParams();
  // useEffect(() => {
  //   // Don't allow the token to persist in the page address
  //   if (params.get("token")) {
  //     params.delete("token");
  //     setParams(params, { replace: true });
  //   }
  // }, [params, setParams]);

  const [settings] = useLocalStorage();
  const [component, setComponent] = useState(
    buildStorableComponent(component_.data, String(component_.id)),
  );
  // TODO: use this to reduce "flicker" when opening/closing modal
  // const [editingFlowOpen, setEditingFlowOpen] = useState(false);
  const [editingFlow, setEditingFlow] = useState<EditingFlowData | undefined>();

  const [rows, setRows] = useState<
    APIActionRowComponent<APIMessageActionRowComponent>[]
  >(message?.components ?? []);

  const [position, setPosition] = useReducer(
    (pos: [number, number], newPos: [number, number]) => {
      const [oY] = pos;
      let [y, x] = newPos;

      if (y < 0 || y > 4 || x < 0 || x > 4) return pos;

      let row = rows[y];
      if (!row && rows.length < 5) {
        rows.splice(y, 0, {
          type: ComponentType.ActionRow,
          components: [],
        });
        row = rows[y];
      }
      if (!row) {
        // No room, don't move
        return pos;
      } else if (getRowWidth(row) >= 5) {
        // row is full, find a different one in the same direction
        const nextEmptyRow = rows.find(
          (r, i) =>
            (y < oY ? i < y : i > y) &&
            5 - getComponentWidth(component) - getRowWidth(r) >= 0,
        );
        if (nextEmptyRow) {
          y = rows.indexOf(nextEmptyRow);
        } else {
          // No room, don't move
          return pos;
        }
      }

      return [Math.min(rows.length, y), Math.min(row.components.length, x)] as [
        number,
        number,
      ];
    },
    [0, 0],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies:
  useEffect(() => {
    let found = false;
    for (const row of rows) {
      let i = -1;
      for (const child of row.components) {
        i += 1;
        if (component.custom_id && child.custom_id === component.custom_id) {
          // It will later be replaced with the stateful value
          row.components.splice(i, 1);
          found = true;
          setPosition([rows.indexOf(row), i]);
          break;
        }
      }
    }
    if (!found) {
      const row = rows.find((row) => getRowWidth(row) < 5);
      if (!row) {
        // This component needs a new row, which needs to really exist
        rows.push({
          type: ComponentType.ActionRow,
          components: [component],
        });
        setPosition([rows.length - 1, 0]);
      } else {
        setPosition([rows.indexOf(row), row.components.length]);
      }
    }
    setRows([...rows]);
  }, []);

  const rowsWithLive = getRowsWithInsertedComponent(rows, component, position);

  // const [overflowMessage, setOverflowMessage] = useState(false);
  const webhookTokenFetcher = useSafeFetcher<typeof ApiGetGuildWebhookToken>({
    onError: setError,
  });

  return (
    <div>
      <FlowEditModal
        open={!!editingFlow}
        setOpen={() => setEditingFlow(undefined)}
        {...editingFlow}
        cache={cache}
      />
      <Header user={user} />
      <Prose className="max-w-xl">
        {error}
        {!!editingMeta && (
          <div
            className={twJoin(
              "mb-4 p-2 rounded-full shadow flex dark:shadow-lg border border-gray-300/80 dark:border-gray-300/20",
            )}
          >
            <img
              {...cdnImgAttributes(64, (size) =>
                getUserAvatar(
                  {
                    discordUser: {
                      id: BigInt(editingMeta.user.id),
                      avatar: editingMeta.user.avatar,
                      discriminator: "0",
                    },
                  },
                  { size },
                ),
              )}
              alt={editingMeta.user.name}
              className="rounded-full my-auto ltr:mr-2 rtl:ml-2 h-10 w-10"
            />
            <div className="my-auto">
              <p className="text-gray-500 font-medium text-sm">
                {t("editingComponentFromUser", {
                  replace: { type: component.type },
                })}
              </p>
              <p className="font-semibold text-lg leading-none">
                {editingMeta.user.name}
              </p>
            </div>
          </div>
        )}
        {/* <Checkbox
          label="Full width message preview"
          checked={overflowMessage}
          onChange={(e) => setOverflowMessage(e.currentTarget.checked)}
          className="mb-1"
        /> */}
        <div
          className={twJoin(
            "mb-4 p-4 rounded-lg shadow dark:shadow-lg border border-gray-300/80 dark:border-gray-300/20",
            // overflowMessage ? "w-fit overflow-x-auto" : undefined,
          )}
        >
          <Message
            message={{ components: rowsWithLive }}
            cache={cache}
            messageDisplay={settings.messageDisplay}
            compactAvatars={settings.compactAvatars}
          />
        </div>
        <div className="mb-4">
          <p className="text-sm font-medium cursor-default">
            <Trans
              t={t}
              i18nKey="positionLink"
              components={[
                <Link
                  to="/guide/getting-started/positioning"
                  target="_blank"
                  className={twJoin(linkClassName, "cursor-pointer")}
                />,
              ]}
            />
          </p>
          <div className="flex">
            <div className="w-1/2 grid grid-cols-2 gap-1 ltr:mr-1 rtl:ml-1">
              <ArrowButton
                icon="Chevron_Up"
                onClick={() => setPosition([position[0] - 1, position[1]])}
                disabled={position[0] <= 0}
              />
              <ArrowButton
                icon="Chevron_Down"
                onClick={() => setPosition([position[0] + 1, position[1]])}
                disabled={position[0] >= 4}
              />
            </div>
            {/*
              The message preview is always LTR so we force it here too since
              we're controlling an element in the preview. A bit janky but
              preferable to duplicating the elements.
            */}
            <div dir="ltr" className="w-1/2 grid grid-cols-2 gap-1">
              <ArrowButton
                icon="Chevron_Left"
                onClick={() => setPosition([position[0], position[1] - 1])}
                disabled={position[1] <= 0}
              />
              <ArrowButton
                icon="Chevron_Right"
                onClick={() => setPosition([position[0], position[1] + 1])}
                disabled={
                  position[1] >= 4 ||
                  (rows[position[0]] &&
                    position[1] === rows[position[0]].components.length)
                }
              />
            </div>
          </div>
        </div>
        <ComponentEditForm
          t={t}
          component={component}
          setComponent={(newComponent) => setComponent({ ...newComponent })}
          cache={cache}
          setEditingFlow={setEditingFlow}
        />
        <hr className="border-black/5 dark:border-gray-200/20 my-4" />
        <div className="gap-1 flex">
          <Button
            onClick={async () => {
              const updated = await submitComponent(component);
              if (updated) {
                setComponent(updated);
              }
            }}
          >
            {t(component_.draft ? "saveDraft" : "save")}
          </Button>
          {/*
            TODO: modal for selecting/sending a new message for this component if
            the draft is not already associated with a message. This should be
            a relatively uncommon situtation since this page is only linked when
            adding a component with the bot.
          */}
          {editingMeta ? (
            <Button
              disabled={!token}
              discordstyle={ButtonStyle.Success}
              onClick={async () => {
                if (token) {
                  submit(
                    {
                      token,
                      row: position[0],
                      column: position[1],
                    },
                    { method: "PATCH", replace: true },
                  );
                }
              }}
            >
              {component_.draft
                ? t("addComponentType", { replace: { type: component.type } })
                : t("editMessage")}
            </Button>
          ) : (
            <Button
              disabled={
                !component_.messageId ||
                !component_.guildId ||
                !message?.webhook_id
              }
              discordstyle={ButtonStyle.Success}
              onClick={async () => {
                if (
                  component_.messageId &&
                  component_.guildId &&
                  message?.webhook_id
                ) {
                  const tokenResponse = await webhookTokenFetcher.loadAsync(
                    apiUrl(
                      BRoutes.guildWebhookToken(
                        component_.guildId,
                        message.webhook_id,
                      ),
                    ),
                  );
                  await submitMessage(tokenResponse, {
                    data: { components: rowsWithLive },
                    reference: component_.messageId.toString(),
                  });
                  if (component_.draft) {
                    // Tell the server that something changed and
                    // it needs to fetch the message
                    submit(null, { method: "PATCH", replace: true });
                  }
                }
              }}
            >
              {t("editMessage")}
            </Button>
          )}
        </div>
        {!component_.draft && (
          <p className="italic text-gray-300/80 text-sm mt-1">
            {t("componentSaveEditMessageTip")}
          </p>
        )}
      </Prose>
    </div>
  );
}

const ArrowButton: React.FC<{
  icon: CoolIconsGlyph;
  onClick: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
}> = ({ icon, onClick, disabled }) => (
  <Button
    className="w-full"
    discordstyle={ButtonStyle.Secondary}
    onClick={onClick}
    disabled={disabled}
  >
    <CoolIcon icon={icon} />
  </Button>
);
