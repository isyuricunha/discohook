import {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  messageLink,
} from "@discordjs/builders";
import dedent from "dedent-js";
import {
  APIButtonComponent,
  APIInteraction,
  APIMessage,
  APIModalInteractionResponseCallbackData,
  APISelectMenuComponent,
  APIStringSelectComponent,
  APIWebhook,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  Routes,
  TextInputStyle,
} from "discord-api-types/v10";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { getDb, getchGuild, upsertDiscordUser, upsertGuild } from "store";
import {
  discordMessageComponents,
  flows,
  generateId,
  makeSnowflake,
  tokens,
} from "store/src/schema";
import { StorableComponent } from "store/src/types";
import { InteractionInstantOrDeferredResponse } from "../../commands.js";
import {
  ButtonCallback,
  MinimumKVComponentState,
  ModalCallback,
  SelectMenuCallback,
} from "../../components.js";
import { InteractionContext } from "../../interactions.js";
import { Env } from "../../types/env.js";
import { webhookAvatarUrl } from "../../util/cdn.js";
import {
  getComponentWidth,
  getRowWidth,
  storeComponents,
} from "../../util/components.js";
import { isDiscordError } from "../../util/error.js";
import { color } from "../../util/meta.js";
import { BUTTON_URL_RE } from "../../util/regex.js";
import { getUserPremiumDetails } from "../../util/user.js";

const buildStorableComponent = (
  component: StorableComponent,
  customId?: string,
): APIButtonComponent | APISelectMenuComponent | undefined => {
  switch (component.type) {
    case ComponentType.Button:
      return {
        type: component.type,
        custom_id: component.style === ButtonStyle.Link ? undefined : customId,
        url: component.style === ButtonStyle.Link ? component.url : undefined,
        style: component.style,
        label: component.label,
        emoji: component.emoji,
        disabled: component.disabled,
      } as APIButtonComponent;
    case ComponentType.StringSelect:
      return {
        type: component.type,
        custom_id: customId,
        placeholder: component.placeholder,
        disabled: component.disabled,
        min_values: component.minValues,
        max_values: component.maxValues,
        options: component.options,
      } as APIStringSelectComponent;
    case ComponentType.UserSelect:
    case ComponentType.RoleSelect:
    case ComponentType.MentionableSelect:
    case ComponentType.ChannelSelect:
      return {
        type: component.type,
        custom_id: customId,
        placeholder: component.placeholder,
        disabled: component.disabled,
        min_values: component.minValues,
        max_values: component.maxValues,
        default_values: component.defaultValues,
      } as APISelectMenuComponent;
    default:
      break;
  }
};

interface ComponentFlow extends MinimumKVComponentState {
  step: number;
  stepTitle: string;
  totalSteps?: number;
  steps?: {
    label: string;
  }[];
  webhookToken: string;
  message: {
    id: string;
    channelId: string;
    guildId: string;
    webhookId: string;
    webhookName: string;
    webhookAvatar: string | null;
  };
  user: {
    id: string;
    premium: ReturnType<typeof getUserPremiumDetails>;
  };
  component?: StorableComponent;
}

const getComponentFlowEmbed = (flow: ComponentFlow) => {
  const embed = new EmbedBuilder({
    title:
      flow.stepTitle +
      (flow.totalSteps
        ? ` - Step ${flow.step}/${flow.totalSteps} (${Math.floor(
            (flow.step / flow.totalSteps) * 100,
          )}%)`
        : ""),
    description: flow.steps
      ? flow.steps.map((step, i) => `${i + 1}. ${step.label}`).join("\n")
      : undefined,
    color,
  }).addFields({
    name: "Message",
    value: messageLink(
      flow.message.channelId,
      flow.message.id,
      flow.message.guildId,
    ),
  });

  if (flow.step === 0) {
    embed.setThumbnail(
      webhookAvatarUrl({
        id: flow.message.webhookId,
        avatar: flow.message.webhookAvatar,
      }),
    );
  } else {
    embed.setAuthor({
      name: flow.message.webhookName.slice(0, 256) || "Webhook",
      iconURL: webhookAvatarUrl({
        id: flow.message.webhookId,
        avatar: flow.message.webhookAvatar,
      }),
    });
  }

  return embed;
};

const registerComponent = async (
  ctx: InteractionContext<APIInteraction>,
  flow: ComponentFlow,
) => {
  // biome-ignore lint/style/noNonNullAssertion: It's not null
  const data = flow.component!;

  const id = BigInt(generateId());
  const customId =
    data.type === ComponentType.Button && data.style === ButtonStyle.Link
      ? undefined
      : `p_${id}`;
  const built = buildStorableComponent(data, customId);
  if (!built) {
    throw new Error(`Failed to built the component (type ${data.type}).`);
  }
  const requiredWidth = getComponentWidth(built);

  let message: APIMessage | undefined = undefined;
  try {
    message = (await ctx.rest.get(
      Routes.webhookMessage(
        flow.message.webhookId,
        flow.webhookToken,
        flow.message.id,
      ),
    )) as APIMessage;
  } catch {
    throw new Error(dedent`
      Failed to fetch the message (${flow.message.id}).
      Make sure the webhook (${flow.message.webhookId})
      exists and is in the same channel.
    `);
  }
  // const components = message.components
  //   ? message.components.map(c => new ActionRowBuilder(c))
  //   : [new ActionRowBuilder()];

  const components = message.components ?? [new ActionRowBuilder().toJSON()];
  let nextAvailableRow = components.find(
    (c) => 5 - getRowWidth(c) >= requiredWidth,
  );
  if (!nextAvailableRow && components.length < 5) {
    nextAvailableRow = new ActionRowBuilder().toJSON();
    components.push(nextAvailableRow);
  } else if (!nextAvailableRow) {
    throw new Error(
      `No available slots for this component (need at least ${requiredWidth}).`,
    );
  }
  nextAvailableRow.components.push(built);

  const db = getDb(ctx.env.HYPERDRIVE);
  const returned = await db
    .insert(discordMessageComponents)
    .values({
      id,
      guildId: makeSnowflake(flow.message.guildId),
      channelId: makeSnowflake(flow.message.channelId),
      messageId: makeSnowflake(flow.message.id),
      createdById: makeSnowflake(flow.user.id),
      type: data.type,
      data,
    })
    .onConflictDoUpdate({
      target: discordMessageComponents.id,
      set: {
        data,
        draft: false,
        updatedAt: new Date(),
        updatedById: makeSnowflake(flow.user.id),
      },
    })
    .returning({
      id: discordMessageComponents.id,
    });

  let editedMsg: APIMessage;
  try {
    editedMsg = (await ctx.rest.patch(
      Routes.webhookMessage(
        flow.message.webhookId,
        flow.webhookToken,
        flow.message.id,
      ),
      { body: { components } },
    )) as APIMessage;
  } catch (e) {
    if (isDiscordError(e)) {
      // await db
      //   .delete(discordMessageComponents)
      //   .where(eq(discordMessageComponents.id, returned[0].id));
      await db
        .update(discordMessageComponents)
        .set({
          draft: true,
        })
        .where(eq(discordMessageComponents.id, returned[0].id));
    }
    throw e;
  }
  return editedMsg;
};

export const startComponentFlow = async (
  ctx: InteractionContext<APIInteraction>,
  message: APIMessage,
): Promise<InteractionInstantOrDeferredResponse> => {
  const db = getDb(ctx.env.HYPERDRIVE);
  const user = await upsertDiscordUser(db, ctx.user);

  if (!message.webhook_id) {
    return ctx.reply({
      content: "This is not a webhook message.",
      flags: MessageFlags.Ephemeral,
    });
  }
  const webhook = (await ctx.rest.get(
    Routes.webhook(message.webhook_id),
  )) as APIWebhook;
  const webhookToken = webhook.token;
  if (!webhookToken) {
    return ctx.reply({
      content: dedent`
        Webhook token (ID ${message.webhook_id}) was not available.
        It may be an incompatible type of webhook, or it may have been
        created by a different bot user.
      `,
      flags: MessageFlags.Ephemeral,
    });
  }

  const componentFlow: ComponentFlow = {
    componentTimeout: 60,
    componentRoutingId: "add-component-flow",
    step: 0,
    stepTitle: "Add Component",
    webhookToken,
    message: {
      id: message.id,
      channelId: message.channel_id,
      // biome-ignore lint/style/noNonNullAssertion: Guild-only command
      guildId: ctx.interaction.guild_id!,
      webhookId: message.webhook_id,
      webhookName: message.author.username,
      webhookAvatar: message.author.avatar,
    },
    user: {
      id: String(user.id),
      premium: getUserPremiumDetails(user),
    },
  };

  // Maybe switch to a quickie web form instead of a long flow like this
  // but some users prefer to stay within discord (for whatever reason!)
  return [
    ctx.reply({
      embeds: [getComponentFlowEmbed(componentFlow).toJSON()],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>()
          .addComponents(
            await storeComponents(ctx.env.KV, [
              new StringSelectMenuBuilder({
                placeholder: "Select a component type",
                options: [
                  {
                    label: "Button",
                    description: "One press to execute one or several actions",
                    value: "button",
                    emoji: { name: "🟦" },
                  },
                  {
                    label: "Link Button",
                    description: "Direct a user to a specified URL",
                    value: "link-button",
                    emoji: { name: "🌐" },
                  },
                  {
                    label: "String Select",
                    description:
                      "Select from a custom list of options to execute actions",
                    value: "string-select",
                    emoji: { name: "🔽" },
                  },
                  {
                    label: "User Select",
                    description:
                      "Select from a list of users to execute actions",
                    value: "user-select",
                    emoji: { name: "👤" },
                  },
                  {
                    label: "Role Select",
                    description:
                      "Select from a list of roles to execute actions",
                    value: "role-select",
                    emoji: { name: "🏷️" },
                  },
                  {
                    label: "User/Role Select",
                    description:
                      "Select from a list of users and roles to execute actions",
                    value: "mentionable-select",
                    emoji: { name: "*️⃣" },
                  },
                  {
                    label: "Channel Select",
                    description:
                      "Select from a list of channels to execute actions",
                    value: "channel-select",
                    emoji: { name: "#️⃣" },
                  },
                ],
              }),
              {
                ...componentFlow,
                componentOnce: true,
              },
            ]),
          )
          .toJSON(),
      ],
      flags: MessageFlags.Ephemeral,
    }),
    async () => {
      const guild = await getchGuild(
        ctx.rest,
        ctx.env.KV,
        // biome-ignore lint/style/noNonNullAssertion:
        ctx.interaction.guild_id!,
      );
      await upsertGuild(db, guild);
    },
  ];
};

/**
 * An editor token is a special subset of our JWTs that is scoped for editing
 * one or more components, and does not authorize a request as a user.
 * This flow makes them fairly safe; Even if the token is hijacked, the
 * attacker cannot edit the message itself or send any new messages to the server.
 *
 * The drawback is that if the user wants to add a custom message action, they
 * will need to log in the long way through OAuth to access their backups.
 */
const createEditorToken = async (env: Env) => {
  const secretKey = Uint8Array.from(
    env.TOKEN_SECRET.split("").map((x) => x.charCodeAt(0)),
  );

  const now = new Date();
  // 2 hours
  const expiresAt = new Date(now.getTime() + 7_200_000);
  const id = generateId(now);
  const token = await new SignJWT({ scp: "editor" })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(id)
    .setIssuedAt(now)
    .setIssuer(env.DISCOHOOK_ORIGIN)
    .setExpirationTime(expiresAt)
    .sign(secretKey);

  return { id, value: token, expiresAt };
};

export const continueComponentFlow: SelectMenuCallback = async (ctx) => {
  const value = ctx.interaction.data.values[0];

  const state = ctx.state as ComponentFlow;
  state.steps = [];
  state.steps.push({
    label: `Select component type (${value.replace("-", " ")})`,
  });
  state.step += 1;

  switch (value) {
    case "button": {
      const db = getDb(ctx.env.HYPERDRIVE);

      const { id: flowId } = (
        await db.insert(flows).values({}).returning({ id: flows.id })
      )[0];

      state.component = state.component ?? {
        type: ComponentType.Button,
        style: ButtonStyle.Primary,
        flowId: String(flowId),
        label: "Button",
      };

      const component = (
        await db
          .insert(discordMessageComponents)
          .values({
            guildId: makeSnowflake(state.message.guildId),
            channelId: makeSnowflake(state.message.channelId),
            messageId: makeSnowflake(state.message.id),
            type: state.component.type,
            data: state.component,
            createdById: makeSnowflake(state.user.id),
            updatedById: makeSnowflake(state.user.id),
            draft: true,
          })
          .returning({
            id: discordMessageComponents.id,
          })
      )[0];

      const editorToken = await createEditorToken(ctx.env);
      await db.insert(tokens).values({
        platform: "discord",
        id: makeSnowflake(editorToken.id),
        prefix: "editor",
        expiresAt: editorToken.expiresAt,
        // userId: makeSnowflake(state.user.id),
      });

      await ctx.env.KV.put(
        `token-${editorToken.id}-component-${component.id}`,
        JSON.stringify({
          interactionId: ctx.interaction.id,
          user: {
            id: ctx.user.id,
            name: ctx.user.username,
            avatar: ctx.user.avatar,
          },
        }),
        {
          expiration: Math.floor(editorToken.expiresAt.getTime() / 1000),
        },
      );

      state.stepTitle = "Finish in the editor";
      // state.totalSteps = 3;
      state.steps.push(
        {
          label:
            'Click "Customize" to set details and flows **<--- you are here**',
        },
        {
          label: 'Finish editing and click "Add Button" in the tab',
        },
      );

      return ctx.updateMessage({
        embeds: [getComponentFlowEmbed(state).toJSON()],
        components: [
          new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel("Customize")
                .setURL(
                  `${ctx.env.DISCOHOOK_ORIGIN}/edit/component/${
                    component.id
                  }?${new URLSearchParams({
                    token: editorToken.value,
                  })}`,
                ),
              // new ButtonBuilder()
              //   .setStyle(ButtonStyle.Success)
              //   .setLabel("Add Button")
              //   .setDisabled(true)
              //   .setCustomId(
              //     // We use the login token to temporarily transmit the
              //     // position of the button in the message. We don't like to
              //     // store this info in the database because it's hard to keep
              //     // track of - we match components to real Discord state instead.
              //     `a_submit-component_${component.id}:${editorToken.id}` satisfies AutoComponentCustomId,
              //   ),
            )
            .toJSON(),
        ],
      });
    }
    case "link-button": {
      state.stepTitle = "Customize the button's link, label, & emoji";
      state.totalSteps = 3;
      state.component = {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        url: "",
      };

      const modal = new ModalBuilder()
        .setTitle("Custom button values")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("label")
              .setLabel("Label")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(80)
              .setPlaceholder("The text displayed on this button."),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("emoji")
              .setLabel("Emoji")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setPlaceholder("Like :smile: or a custom emoji in the server."),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("url")
              .setLabel("Button URL")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setPlaceholder(
                "The full URL this button will lead to when it is clicked.",
              ),
          ),
        );

      await storeComponents(ctx.env.KV, [
        modal,
        {
          ...state,
          componentTimeout: 600,
          componentRoutingId: "add-component-flow_customize-modal",
          componentOnce: false,
        },
      ]);

      return [
        ctx.modal(modal.toJSON()),
        async () => {
          await ctx.followup.editOriginalMessage({
            embeds: [getComponentFlowEmbed(state).toJSON()],
            components: [
              new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                  await storeComponents(ctx.env.KV, [
                    new ButtonBuilder({
                      style: ButtonStyle.Primary,
                      label: "Open modal",
                    }),
                    {
                      componentRoutingId:
                        "add-component-flow-customize-modal-resend",
                      componentTimeout: 600,
                      modal: modal.toJSON(),
                    },
                  ]),
                )
                .toJSON(),
            ],
          });
        },
      ];
    }
    case "string-select":
    case "user-select":
    case "role-select":
    case "mentionable-select":
    case "channel-select": {
      const db = getDb(ctx.env.HYPERDRIVE);
      const { id: flowId } =
        state.component ?? value === "string-select"
          ? { id: 0 }
          : (await db.insert(flows).values({}).returning({ id: flows.id }))[0];

      state.component =
        state.component ?? value === "string-select"
          ? {
              type: ComponentType.StringSelect,
              options: [],
              flowIds: {},
            }
          : {
              type:
                value === "user-select"
                  ? ComponentType.UserSelect
                  : value === "role-select"
                    ? ComponentType.RoleSelect
                    : value === "mentionable-select"
                      ? ComponentType.MentionableSelect
                      : ComponentType.ChannelSelect,
              flowId: String(flowId),
            };

      const component = (
        await db
          .insert(discordMessageComponents)
          .values({
            guildId: makeSnowflake(state.message.guildId),
            channelId: makeSnowflake(state.message.channelId),
            messageId: makeSnowflake(state.message.id),
            type: state.component.type,
            data: state.component,
            createdById: makeSnowflake(state.user.id),
            updatedById: makeSnowflake(state.user.id),
            draft: true,
          })
          .returning({
            id: discordMessageComponents.id,
          })
      )[0];

      const editorToken = await createEditorToken(ctx.env);
      await db.insert(tokens).values({
        platform: "discord",
        id: makeSnowflake(editorToken.id),
        prefix: "editor",
        expiresAt: editorToken.expiresAt,
        // userId: makeSnowflake(state.user.id),
      });

      await ctx.env.KV.put(
        `token-${editorToken.id}-component-${component.id}`,
        JSON.stringify({
          interactionId: ctx.interaction.id,
          user: {
            id: ctx.user.id,
            name: ctx.user.username,
            avatar: ctx.user.avatar,
          },
        }),
        {
          expiration: Math.floor(editorToken.expiresAt.getTime() / 1000),
        },
      );

      state.stepTitle = "Finish in the editor";
      // state.totalSteps = 3;
      state.steps.push(
        {
          label:
            'Click "Customize" to set details and flows **<--- you are here**',
        },
        {
          label: 'Finish editing and click "Add Select" in the tab',
        },
      );

      return ctx.updateMessage({
        embeds: [getComponentFlowEmbed(state).toJSON()],
        components: [
          new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
              new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel("Customize")
                .setURL(
                  `${ctx.env.DISCOHOOK_ORIGIN}/edit/component/${
                    component.id
                  }?${new URLSearchParams({
                    token: editorToken.value,
                  })}`,
                ),
            )
            .toJSON(),
        ],
      });
    }
    default:
      break;
  }

  return ctx.updateMessage({
    embeds: [getComponentFlowEmbed(state).toJSON()],
    components: [],
  });
};

export const reopenCustomizeModal: ButtonCallback = async (ctx) => {
  const state = ctx.state as MinimumKVComponentState & {
    modal: APIModalInteractionResponseCallbackData;
  };
  return ctx.modal(state.modal);
};

export const submitCustomizeModal: ModalCallback = async (ctx) => {
  const state = ctx.state as ComponentFlow;

  if (state.component?.type === ComponentType.Button) {
    const label = ctx.getModalComponent("label").value;
    const emoji = ctx.getModalComponent("emoji").value;

    if (!label && !emoji) {
      return ctx.reply({
        content: "Must provide either a label or emoji.",
        flags: MessageFlags.Ephemeral,
      });
    }

    state.component.label = label;
    // state.component.emoji = emoji;
    // state.step += 1;
    // state.steps?.push({ label: `Set label (${escapeMarkdown(label)})` });
    // state.step += 1;
    // state.steps?.push({ label: `Set emoji (${escapeMarkdown(label)})` });

    if (state.component.style === ButtonStyle.Link) {
      const url = ctx.getModalComponent("url").value;
      if (!BUTTON_URL_RE.test(url)) {
        return ctx.reply({
          content:
            "Invalid URL. Must be a `http://`, `https://`, or `discord://` address.",
          flags: MessageFlags.Ephemeral,
        });
      }
      try {
        new URL(url);
      } catch {
        return ctx.reply({
          content: "Invalid URL.",
          flags: MessageFlags.Ephemeral,
        });
      }

      state.component.url = url;
      state.step += 1;
      state.steps?.push({ label: "Set label, emoji, and URL" });

      try {
        await registerComponent(ctx, state);
      } catch (e) {
        console.error(e);
        return ctx.reply({ content: String(e), flags: MessageFlags.Ephemeral });
      }

      return ctx.updateMessage({
        embeds: [getComponentFlowEmbed(state).toJSON()],
        components: [],
      });
    }
  }

  return ctx.reply("a");
};
