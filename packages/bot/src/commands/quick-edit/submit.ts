import {
  APIAttachment,
  APIEmbed,
  APIEmbedField,
  APIInteractionResponse,
  APIMessage,
  APIWebhook,
  ComponentType,
  PermissionFlagsBits,
  RESTPatchAPIWebhookWithTokenMessageJSONBody,
  Routes,
} from "discord-api-types/v10";
import { APIMessageReducedWithId, cacheMessage, getchMessage } from "store";
import { ModalCallback } from "../../components.js";
import {
  InteractionContext,
  isInteractionResponse,
} from "../../interactions.js";
import { parseAutoComponentId, textDisplay } from "../../util/components.js";
import { isDiscordError } from "../../util/error.js";
import { getWebhook } from "../webhooks/webhookInfo.js";
import {
  getQuickEditAttachmentContainer,
  getQuickEditEmbedContainer,
  missingElement
} from "./entry.js";

const submitWebhookMessageEdit = async (
  ctx: InteractionContext,
  webhook: APIWebhook,
  message: Pick<APIMessage, "id" | "position" | "channel_id">,
  body: RESTPatchAPIWebhookWithTokenMessageJSONBody,
  after: (updated: APIMessage) => Promise<void>,
): Promise<[APIInteractionResponse, () => Promise<void>]> => {
  return [
    ctx.defer(),
    async () => {
      let updated: APIMessage;
      try {
        updated = (await ctx.rest.patch(
          // biome-ignore lint/style/noNonNullAssertion:
          Routes.webhookMessage(webhook.id, webhook.token!, message.id),
          {
            body,
            query:
              message.position !== undefined
                ? new URLSearchParams({ thread_id: message.channel_id })
                : undefined,
          },
        )) as APIMessage;
      } catch (e) {
        if (isDiscordError(e)) {
          await ctx.followup.send({
            content: `Discord rejected the edit: **${
              e.rawError.message
            }**\`\`\`json\n${JSON.stringify(e.rawError)}\`\`\``,
            ephemeral: true,
          });
        }
        throw e;
      }

      // https://github.com/discord/discord-api-docs/issues/7570
      if (updated.position !== message.position) {
        updated.position = message.position;
      }

      // Re-cache the message so subsequent edits use the newest version of
      // the message. Cached with a shorter TTL than normal.
      await cacheMessage(ctx.env, updated, webhook.guild_id, 600);
      await after(updated);
    },
  ];
};

const verifyWebhookMessageEditPermissions = async (
  ctx: InteractionContext,
  channelId: string,
  messageId: string,
) => {
  const message = await getchMessage(ctx.rest, ctx.env, channelId, messageId, {
    guildId: ctx.interaction.guild_id,
  });
  if (!message.webhook_id) {
    throw ctx.reply({
      content: "Somehow, this isn't a webhook message.",
      ephemeral: true,
    });
  }

  const webhook = await getWebhook(
    message.webhook_id,
    ctx.env,
    message.application_id,
  );
  if (
    !webhook.guild_id ||
    webhook.guild_id !== ctx.interaction.guild_id ||
    !ctx.userPermissons.has(
      PermissionFlagsBits.ManageWebhooks,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ReadMessageHistory,
    )
  ) {
    throw ctx.reply({
      content:
        "You don't have the appropriate permissions to edit webhook messages.",
      ephemeral: true,
    });
  }
  if (!webhook.token) {
    throw ctx.reply({
      content: "The webhook's token was inaccessible.",
      ephemeral: true,
    });
  }
  return { message, webhook };
};

const modifyEmbedByPath = (embed: APIEmbed, path: string, value: string) => {
  const [part, subPart] = path.split(".");

  switch (part) {
    case "author":
      if (subPart === "name" && !value) {
        // Remove author
        embed.author = undefined;
      } else {
        embed.author = embed.author ?? { name: "" };
        embed.author[subPart as "name" | "icon_url" | "url"] = value;
      }
      break;
    case "title":
    case "url":
    case "description":
      embed[part] = value || undefined;
      break;
    case "thumbnail":
    case "image":
      if (subPart === "url") {
        embed[part] = embed[part] ?? { url: "" };
        embed[part].url = value;
      }
      break;
    case "fields": {
      embed.fields = embed.fields ?? [];
      const index = Number(subPart);
      const field = embed.fields[index];
      const [, , fieldProp] = path.split(".");
      if (field) {
        if (fieldProp === "inline") {
          field.inline = value === "true";
        } else {
          field[fieldProp as "name" | "value"] = value;
        }
      } else {
        const newField: APIEmbedField = { name: "", value: "" };
        if (fieldProp === "inline") {
          newField.inline = value === "true";
        } else {
          newField[fieldProp as "name" | "value"] = value;
        }
        embed.fields.splice(index, 0, newField);
      }
      break;
    }
    case "footer":
      if (subPart === "text" && !value) {
        // Remove footer
        embed.footer = undefined;
      } else {
        embed.footer = embed.footer ?? { text: "" };
        embed.footer[subPart as "text" | "icon_url"] = value;
      }
      break;
    case "timestamp": {
      if (!value) {
        embed.timestamp = undefined;
      } else {
        const date = new Date(value);
        if (!Number.isNaN(date)) {
          embed.timestamp = date.toISOString();
        }
      }
      break;
    }
    default:
      break;
  }

  return embed;
};

const trimEmptyEmbedParts = (embed: APIEmbed) => {
  if (embed.author && !embed.author.name) {
    embed.author = undefined;
  }
  if (embed.footer && !embed.footer.text) {
    embed.footer = undefined;
  }
  if (embed.thumbnail && !embed.thumbnail.url) {
    embed.thumbnail = undefined;
  }
  if (embed.image && !embed.image.url) {
    embed.image = undefined;
  }
  return embed;
};

// If an embed with an `attachment://` image is updated without re-including
// the attachment URI, the attachment will appear duplicated above the embeds.
const maintainAttachmentReferences = (
  channelId: string,
  embed: APIEmbed,
  attachments: APIAttachment[],
) => {
  const replaceAttachmentUrl = (
    value: string | undefined,
    callback: (newValue: string) => void,
  ) => {
    if (!value) return;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return;
    }

    if (
      url.host === "cdn.discordapp.com" &&
      url.pathname.startsWith(`/attachments/${channelId}/`)
    ) {
      const attachmentId = url.pathname.split("/")[3];
      const attachment = attachments.find((a) => a.id === attachmentId);
      if (attachment) {
        callback(`attachment://${attachment.filename}`);
      }
    }
  };

  replaceAttachmentUrl(embed.author?.icon_url, (url) => {
    if (embed.author) embed.author.icon_url = url;
  });
  replaceAttachmentUrl(embed.footer?.icon_url, (url) => {
    if (embed.footer) embed.footer.icon_url = url;
  });
  replaceAttachmentUrl(embed.image?.url, (url) => {
    embed.image = { url };
  });
  replaceAttachmentUrl(embed.thumbnail?.url, (url) => {
    embed.thumbnail = { url };
  });

  return embed;
};

export const quickEditSubmitContent: ModalCallback = async (ctx) => {
  const { channelId, messageId } = parseAutoComponentId(
    ctx.interaction.data.custom_id,
    "channelId",
    "messageId",
  );
  let webhook: APIWebhook;
  let message: APIMessageReducedWithId;
  try {
    ({ webhook, message } = await verifyWebhookMessageEditPermissions(
      ctx,
      channelId,
      messageId,
    ));
  } catch (e) {
    if (isInteractionResponse(e)) return e;
    throw e;
  }

  const { value } = ctx.getModalComponent("content");
  message.content = value.trim();

  return submitWebhookMessageEdit(
    ctx,
    webhook,
    message,
    { content: message.content },
    async () => {
      await ctx.followup.editOriginalMessage({
        components: [textDisplay("Updated content.")],
      });
    },
  );
};

export const quickEditSubmitEmbed: ModalCallback = async (ctx) => {
  const { channelId, messageId, embedIndex } = parseAutoComponentId(
    ctx.interaction.data.custom_id,
    "channelId",
    "messageId",
    "embedIndex",
    "embedPart", // Ignored; see open.ts `quickEditEmbedPartOpen`
  );
  let webhook: APIWebhook;
  let message: APIMessageReducedWithId;
  try {
    ({ webhook, message } = await verifyWebhookMessageEditPermissions(
      ctx,
      channelId,
      messageId,
    ));
  } catch (e) {
    if (isInteractionResponse(e)) return e;
    throw e;
  }
  const embed = message.embeds?.[Number(embedIndex)];
  if (!embed) {
    return ctx.reply({ content: missingElement, ephemeral: true });
  }

  for (const row of ctx.interaction.data.components) {
    if (row.type !== ComponentType.ActionRow) continue;
    for (const input of row.components.filter(
      (c) => c.type === ComponentType.TextInput,
    )) {
      // These should all be valid references for existing or new parts
      modifyEmbedByPath(embed, input.custom_id, input.value);
    }
  }

  trimEmptyEmbedParts(embed);
  return submitWebhookMessageEdit(
    ctx,
    webhook,
    message,
    { embeds: message.embeds },
    async (updated) => {
      await ctx.followup.editOriginalMessage({
        components: [
          getQuickEditEmbedContainer(updated, embed, Number(embedIndex)),
        ],
      });

      // This is not working quite like how I want it to, for now users will
      // just have to edit via the site to maintain attachment URIs.
      // if (
      //   updated.attachments &&
      //   ((message.attachments &&
      //     updated.attachments.length > message.attachments.length) ||
      //     !message.attachments)
      // ) {
      //   // Attachments already present in embeds are not also present in
      //   // `attachments`, so we have to let Discord show the duplicated
      //   // attachments before copying them back down into the embed.
      //   // Users will see a quick flash of double attachments while this
      //   // happens.
      //   for (const e of updated.embeds) {
      //     maintainAttachmentReferences(channelId, e, updated.attachments ?? []);
      //   }

      //   let uriUpdated: APIMessage | undefined;
      //   try {
      //     uriUpdated = (await ctx.rest.patch(
      //       // biome-ignore lint/style/noNonNullAssertion:
      //       Routes.webhookMessage(webhook.id, webhook.token!, updated.id),
      //       {
      //         body: { embeds: updated.embeds },
      //         query:
      //           updated.position !== undefined
      //             ? new URLSearchParams({ thread_id: updated.channel_id })
      //             : undefined,
      //       },
      //     )) as APIMessage;
      //   } catch {}
      //   if (uriUpdated) {
      //     // https://github.com/discord/discord-api-docs/issues/7570
      //     if (uriUpdated.position !== updated.position) {
      //       uriUpdated.position = updated.position;
      //     }

      //     // If we don't re-cache then the next time this message is edited,
      //     // the attachments won't get fixed
      //     await cacheMessage(ctx.env, uriUpdated, webhook.guild_id, 600);
      //   }
      // }
    },
  );
};

export const quickEditSubmitAttachment: ModalCallback = async (ctx) => {
  const { channelId, messageId, attachmentId } = parseAutoComponentId(
    ctx.interaction.data.custom_id,
    "channelId",
    "messageId",
    "attachmentId",
  );
  let webhook: APIWebhook;
  let message: APIMessageReducedWithId;
  try {
    ({ webhook, message } = await verifyWebhookMessageEditPermissions(
      ctx,
      channelId,
      messageId,
    ));
  } catch (e) {
    if (isInteractionResponse(e)) return e;
    throw e;
  }
  const attachment = message.attachments?.find((a) => a.id === attachmentId);
  if (!attachment) {
    return ctx.reply({ content: missingElement, ephemeral: true });
  }

  let filename = ctx.getModalComponent("filename").value;
  if (ctx.getModalComponent("spoiler").value === "true") {
    if (!filename.startsWith("SPOILER_")) {
      filename = `SPOILER_${filename}`;
    }
  } else if (filename.startsWith("SPOILER_")) {
    filename = filename.replace(/^SPOILER_/, "");
  }
  const description =
    ctx.getModalComponent("description").value.trim() || undefined;

  attachment.filename = filename;
  attachment.description = description;
  return submitWebhookMessageEdit(
    ctx,
    webhook,
    message,
    { attachments: message.attachments },
    async (updated) => {
      await ctx.followup.editOriginalMessage({
        components: [getQuickEditAttachmentContainer(updated, attachment)],
      });
    },
  );
};
