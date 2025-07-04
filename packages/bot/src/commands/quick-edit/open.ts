import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
} from "@discordjs/builders";
import {
  type APIComponentInContainer,
  type APIContainerComponent,
  type APIMessageTopLevelComponent,
  ComponentType,
  TextInputStyle,
} from "discord-api-types/v10";
import { getchMessage } from "store";
import type {
  AutoModalCustomId,
  ButtonCallback,
  SelectMenuCallback,
} from "../../components.js";
import { parseAutoComponentId, textDisplay } from "../../util/components.js";
import {
  getQuickEditEmbedContainer,
  getQuickEditMediaGalleryItemModal,
  getQuickEditSectionModal,
  missingElement,
} from "./entry.js";

// Not designed to work with interactive components - nesting support
// is only for containers.
export const getQuickEditComponentByPath = (
  components: APIMessageTopLevelComponent[],
  path: number[],
) => {
  let parent: APIContainerComponent | undefined;
  let component:
    | APIMessageTopLevelComponent
    | APIComponentInContainer
    | undefined;
  if (path.length > 1) {
    const container = components[path[0]];
    if (container?.type === ComponentType.Container) {
      parent = container;
      component = container.components[path[1]];
    }
  } else {
    component = components[path[0]];
  }
  return { parent, component };
};

export const quickEditComponentModalReopen: ButtonCallback = async (ctx) => {
  const {
    channelId,
    messageId,
    path: path_,
  } = parseAutoComponentId(
    ctx.interaction.data.custom_id,
    "channelId",
    "messageId",
    "path",
  );

  const message = await getchMessage(ctx.rest, ctx.env, channelId, messageId);
  const path = path_.split(".").map(Number);
  const { component } = getQuickEditComponentByPath(
    message.components ?? [],
    path,
  );
  if (!component) {
    return ctx.reply({ content: missingElement, ephemeral: true });
  }

  const index = path[path.length - 1];
  switch (component.type) {
    case ComponentType.MediaGallery: {
      // the value is the index of an item
      const item = component.items[index];
      if (!item) {
        return ctx.reply({ content: missingElement, ephemeral: true });
      }
      return ctx.modal(getQuickEditMediaGalleryItemModal(message, item, path));
    }
    case ComponentType.Section: {
      return ctx.modal(getQuickEditSectionModal(message, component, path));
    }
    default:
      break;
  }

  return ctx.updateMessage({
    components: [textDisplay(`Couldn't determine what data to edit. ${path_}`)],
  });
};

export const buildTextInputRow = (
  construct: (builder: TextInputBuilder) => TextInputBuilder,
) =>
  new ActionRowBuilder<TextInputBuilder>().addComponents(
    construct(new TextInputBuilder()),
  );

export const quickEditEmbedPartOpen: ButtonCallback & SelectMenuCallback =
  async (ctx) => {
    const { channelId, messageId, embedIndex, embedPart } =
      parseAutoComponentId(
        ctx.interaction.data.custom_id,
        "channelId",
        "messageId",
        "embedIndex",
        "embedPart",
      );

    const message = await getchMessage(ctx.rest, ctx.env, channelId, messageId);
    const embed = message.embeds?.[Number(embedIndex)];
    if (!embed) {
      return ctx.reply({ content: missingElement, ephemeral: true });
    }

    let [part, inner] = embedPart.split(".");
    // Normalize select data since the identifier structure is slightly different
    if (ctx.interaction.data.component_type === ComponentType.StringSelect) {
      if (part === "new") {
        part = ctx.interaction.data.values[0];
      } else if (part === "fields") {
        inner = ctx.interaction.data.values[0];
      }
    }

    const modal = new ModalBuilder().setCustomId(
      // `part` is ignored in the callback but must be provided or else
      // Discord assumes this is the same modal as was used for another part
      // and autofills content based on each component's index rather than
      // its custom ID.
      `a_qe-submit-embed_${channelId}:${messageId}:${embedIndex}:${part}` satisfies AutoModalCustomId,
    );

    switch (part) {
      case "author": {
        modal.setTitle("Set Author");
        modal.addComponents(
          buildTextInputRow((input) =>
            input
              .setCustomId("author.name")
              .setLabel("Name")
              .setMaxLength(128)
              .setStyle(TextInputStyle.Paragraph)
              .setValue(embed.author?.name ?? "")
              .setPlaceholder(
                "This must be provided to display the author section.",
              )
              .setRequired(false),
          ),
          buildTextInputRow((input) =>
            input
              .setCustomId("author.url")
              .setLabel("URL")
              .setStyle(TextInputStyle.Short)
              .setValue(embed.author?.url ?? "")
              .setPlaceholder(
                "Directs desktop users to this URL when they click the author name.",
              )
              .setRequired(false),
          ),
          buildTextInputRow((input) =>
            input
              .setCustomId("author.icon_url")
              .setLabel("Icon URL")
              .setStyle(TextInputStyle.Short)
              .setValue(embed.author?.icon_url ?? "")
              .setPlaceholder("An image shown to the left of the author name.")
              .setRequired(false),
          ),
        );
        break;
      }
      case "title":
      case "description": {
        modal.setTitle("Set Body");
        modal.addComponents(
          buildTextInputRow((input) =>
            input
              .setCustomId("title")
              .setLabel("Title")
              .setMaxLength(256)
              .setStyle(TextInputStyle.Paragraph)
              .setValue(embed.title ?? "")
              .setPlaceholder(
                "Large text below the author and above the description.",
              )
              .setRequired(false),
          ),
          buildTextInputRow((input) =>
            input
              .setCustomId("url")
              .setLabel("Title URL")
              .setStyle(TextInputStyle.Short)
              .setValue(embed.url ?? "")
              .setPlaceholder("Open this URL when users click the title.")
              .setRequired(false),
          ),
          buildTextInputRow((input) =>
            input
              .setCustomId("description")
              .setLabel("Description")
              .setMaxLength(4000) // actual limit is 4096, but TextInput is capped lower
              .setStyle(TextInputStyle.Paragraph)
              .setValue(embed.description?.slice(0, 4000) ?? "")
              .setPlaceholder(
                `Markdown-safe text below the title. ${
                  embed.description && embed.description?.length > 4000
                    ? "This value was truncated because Discord's limit for text inputs is 4000."
                    : ""
                }`,
              )
              .setRequired(false),
          ),
        );
        break;
      }
      case "url": {
        modal.setTitle("Set URL");
        modal.addComponents(
          buildTextInputRow((input) =>
            input
              .setCustomId("url")
              .setLabel("URL")
              .setStyle(TextInputStyle.Short)
              .setValue(embed.url ?? "")
              .setPlaceholder(
                "If there is no title, this can still be used alone for image galleries.",
              )
              .setRequired(false),
          ),
        );
        break;
      }
      case "thumbnail": {
        modal.setTitle("Set Thumbnail");
        modal.addComponents(
          buildTextInputRow((input) =>
            input
              .setCustomId("thumbnail.url")
              .setLabel("Thumbnail URL")
              .setStyle(TextInputStyle.Short)
              .setValue(embed.thumbnail?.url ?? "")
              .setPlaceholder(
                "Displayed to the right of all text in the embed.",
              )
              .setRequired(false),
          ),
        );
        break;
      }
      case "fields": {
        const isNewField = inner === "new";
        const prefix = isNewField
          ? `fields.${embed.fields ? embed.fields.length : 0}`
          : `fields.${inner}`;
        const field = isNewField ? undefined : embed.fields?.[Number(inner)];

        modal.setTitle(isNewField ? "New Field" : "Set Field");
        modal.addComponents(
          buildTextInputRow((input) =>
            input
              .setCustomId(`${prefix}.name`)
              .setLabel("Name")
              .setMaxLength(256)
              .setStyle(TextInputStyle.Paragraph)
              .setValue(field?.name ?? "")
              .setPlaceholder(
                "Short, semibold text that supports a markdown subset.",
              )
              .setRequired(isNewField),
          ),
          buildTextInputRow((input) =>
            input
              .setCustomId(`${prefix}.value`)
              .setLabel("Value")
              .setStyle(TextInputStyle.Paragraph)
              .setMaxLength(1024)
              .setValue(field?.value ?? "")
              .setPlaceholder("Markdown-safe text below the field name.")
              .setRequired(isNewField),
          ),
          buildTextInputRow((input) =>
            input
              .setCustomId(`${prefix}.inline`)
              .setLabel("Inline?")
              .setStyle(TextInputStyle.Short)
              .setMinLength(4)
              .setMaxLength(5)
              .setValue(String(field?.inline ?? false))
              .setPlaceholder(
                'Type "true" or "false" for whether this field should display inline with other fields.',
              )
              .setRequired(false),
          ),
        );
        break;
      }
      case "image": {
        modal.setTitle("Set Image");
        modal.addComponents(
          buildTextInputRow((input) =>
            input
              .setCustomId("image.url")
              .setLabel("Image URL")
              .setStyle(TextInputStyle.Short)
              .setValue(embed.image?.url ?? "")
              .setPlaceholder(
                "Displayed as a large image below all sections except the footer.",
              )
              .setRequired(false),
          ),
        );
        break;
      }
      case "footer": {
        modal.setTitle("Set Footer");
        modal.addComponents(
          buildTextInputRow((input) =>
            input
              .setCustomId("footer.text")
              .setLabel("Text")
              .setMaxLength(2048)
              .setStyle(TextInputStyle.Paragraph)
              .setValue(embed.footer?.text ?? "")
              .setPlaceholder(
                "This must be provided to display the footer icon, but is optional for the timestamp.",
              )
              .setRequired(false),
          ),
          buildTextInputRow((input) =>
            input
              .setCustomId("footer.icon_url")
              .setLabel("Icon URL")
              .setStyle(TextInputStyle.Short)
              .setValue(embed.footer?.icon_url ?? "")
              .setPlaceholder("An image shown to the left of the footer text.")
              .setRequired(false),
          ),
          buildTextInputRow((input) =>
            input
              .setCustomId("timestamp")
              .setLabel("Timestamp")
              .setStyle(TextInputStyle.Short)
              .setValue(embed.timestamp ?? "")
              .setPlaceholder(
                'A timestamp like "2025-01-01 14:00:00" or "Jan 1 2025 14:00", parsed in UTC',
              )
              .setRequired(false),
          ),
        );
        break;
      }
      default:
        break;
    }

    if (modal.components.length === 0) {
      return ctx.reply({
        content: "Unable to compile any data to edit.",
        ephemeral: true,
      });
    }
    return [
      ctx.modal(modal),
      async () => {
        // Reset select state
        await ctx.followup.editOriginalMessage({
          components: [
            getQuickEditEmbedContainer(message, embed, Number(embedIndex)),
          ],
        });
      },
    ];
  };
