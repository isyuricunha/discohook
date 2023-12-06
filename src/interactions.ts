import { DiscordApiClient } from "discord-api-methods";
import { getDate, Snowflake } from "discord-snowflake";
import { APIApplicationCommandInteractionDataBooleanOption, APIApplicationCommandInteractionDataIntegerOption, APIApplicationCommandInteractionDataNumberOption, APIApplicationCommandInteractionDataOption, APIApplicationCommandInteractionDataStringOption, APIApplicationCommandInteractionDataSubcommandOption, APIAttachment, APIInteraction, APIInteractionDataResolved, APIInteractionResponseCallbackData, APIInteractionResponseChannelMessageWithSource, APIInteractionResponseDeferredChannelMessageWithSource, APIInteractionResponseDeferredMessageUpdate, APIInteractionResponseUpdateMessage, APIMessage, APIMessageApplicationCommandInteraction, APIMessageComponentInteraction, APIModalInteractionResponse, APIModalInteractionResponseCallbackData, APIModalSubmitInteraction, APIPremiumRequiredInteractionResponse, ApplicationCommandOptionType, ApplicationCommandType, InteractionResponseType, InteractionType, ModalSubmitComponent, RESTGetAPIInteractionFollowupResult, RESTPatchAPIInteractionFollowupJSONBody, RESTPatchAPIInteractionFollowupResult, RESTPostAPIInteractionFollowupJSONBody, RESTPostAPIInteractionFollowupResult, Routes } from "discord-api-types/v10";
import { PermissionFlags, PermissionsBitField } from "discord-bitflag";
import { Env } from "./types/env.js";
import { APIPartialResolvedChannel } from "./types/api.js";
import { MinimumKVComponentState } from "./components.js";

export class InteractionContext<T extends APIInteraction, S extends MinimumKVComponentState | Record<string, any> = {}> {
    public client: DiscordApiClient;
    public interaction: T;
    public followup: InteractionFollowup;
    public env: Env;
    public state: S | Record<string, any> = {};

    constructor(client: DiscordApiClient, interaction: T, env: Env, state?: S) {
      this.client = client;
      this.interaction = interaction;
      this.env = env;
      this.followup = new InteractionFollowup(client, interaction, env.DISCORD_APPLICATION_ID);

      if (state) {
        this.state = state;
      }
    }

    get createdAt(): Date {
      return getDate(this.interaction.id as Snowflake);
    }

    get appPermissons() {
      return new PermissionsBitField(this.interaction.app_permissions
        ? BigInt(this.interaction.app_permissions)
        : 0
      );
    }

    get userPermissons() {
      return new PermissionsBitField(this.interaction.member
        ? BigInt(this.interaction.member.permissions)
        : PermissionFlags.ViewChannel
          | PermissionFlags.ReadMessageHistory
          | PermissionFlags.SendMessages
          | PermissionFlags.AddReactions
          | PermissionFlags.EmbedLinks
      );
    }

    get user() {
      return this.interaction.member ? this.interaction.member.user : this.interaction.user!
    }

    getMessage(): T extends APIMessageApplicationCommandInteraction ? APIMessage : undefined;
    getMessage(): T extends APIMessageComponentInteraction ? APIMessage : undefined;
    getMessage(): APIMessage | undefined {
      if (
        this.interaction.type === InteractionType.ApplicationCommand &&
        this.interaction.data.type === ApplicationCommandType.Message
      ) {
        return this.interaction.data.resolved.messages[this.interaction.data.target_id];
      } else if (
        this.interaction.type === InteractionType.MessageComponent
      ) {
        return this.interaction.message;
      }
    }

    _getSubcommand(): APIApplicationCommandInteractionDataSubcommandOption | null {
      if (
        ![
          InteractionType.ApplicationCommand,
          InteractionType.ApplicationCommandAutocomplete,
        ].includes(this.interaction.type) ||
        !this.interaction.data ||
        !("options" in this.interaction.data) ||
        !this.interaction.data.options
      ) {
        return null;
      }

      let subcommand: APIApplicationCommandInteractionDataSubcommandOption | null = null;
      const loop = (option: APIApplicationCommandInteractionDataOption) => {
        if (subcommand) return;
        if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
          for (const opt of option.options) {
            loop(opt)
          }
        } else if (option.type === ApplicationCommandOptionType.Subcommand) {
          subcommand = option;
        }
      }
      for (const option of this.interaction.data.options) {
        loop(option)
      }

      return subcommand
    }
  
    _getOption(name: string) {
      if (
        ![
          InteractionType.ApplicationCommand,
          InteractionType.ApplicationCommandAutocomplete,
        ].includes(this.interaction.type) ||
        !this.interaction.data ||
        !("options" in this.interaction.data) ||
        !this.interaction.data.options
      ) {
        return null;
      }
      const subcommand = this._getSubcommand();
      const options = subcommand ? subcommand.options : this.interaction.data.options;
      if (!options) {
        return null;
      }

      return options.find((o) => o.name === name);
    }

    _getOptionWithDefault<O extends APIApplicationCommandInteractionDataOption>(
      name: string,
      type: ApplicationCommandOptionType,
      def: Partial<O>
    ): O {
      const option = this._getOption(name);
      if (!option || option.type !== type) {
        return {
          name,
          type,
          ...def
        } as O;
      }
      return option as O;
    }

    _getResolvableOption<O>(
      name: string,
      type: (
        | ApplicationCommandOptionType.User
        | ApplicationCommandOptionType.Mentionable
        | ApplicationCommandOptionType.Role
        | ApplicationCommandOptionType.Channel
        | ApplicationCommandOptionType.Attachment
      ),
      key: keyof APIInteractionDataResolved,
    ) {
      const option = this._getOption(name);
      if (
        !option ||
        option.type !== type ||
        !(
          this.interaction.type === InteractionType.ApplicationCommand ||
          this.interaction.type === InteractionType.ApplicationCommandAutocomplete
        ) ||
        !this.interaction.data.resolved
      ) {
        return null;
      }

      const id = option.value;
      // @ts-ignore
      const objects = this.interaction.data.resolved[key];
      if (!objects) return null;

      const object = objects[id];
      if (!object) return null;

      return object as O;
    }

    getStringOption(name: string) {
      return this._getOptionWithDefault<APIApplicationCommandInteractionDataStringOption>(
        name,
        ApplicationCommandOptionType.String,
        { value: "" },
      );
    }
  
    getIntegerOption(name: string) {
      return this._getOptionWithDefault<APIApplicationCommandInteractionDataIntegerOption>(
        name,
        ApplicationCommandOptionType.Integer,
        { value: -1 },
      );
    }
  
    getNumberOption(name: string) {
      return this._getOptionWithDefault<APIApplicationCommandInteractionDataNumberOption>(
        name,
        ApplicationCommandOptionType.Integer,
        { value: -1 },
      );
    }
  
    getBooleanOption(name: string) {
      return this._getOptionWithDefault<APIApplicationCommandInteractionDataBooleanOption>(
        name,
        ApplicationCommandOptionType.Boolean,
        { value: false },
      );
    }

    getAttachmentOption(name: string) {
      return this._getResolvableOption<APIAttachment>(
        name,
        ApplicationCommandOptionType.Attachment,
        'attachments',
      );
    }

    getChannelOption(name: string) {
      return this._getResolvableOption<APIPartialResolvedChannel>(
        name,
        ApplicationCommandOptionType.Channel,
        'channels',
      );
    }

    getModalComponent(customId: string): T extends APIModalSubmitInteraction ? ModalSubmitComponent : undefined;
    getModalComponent(customId: string): ModalSubmitComponent | undefined {
      if (this.interaction.type !== InteractionType.ModalSubmit) return undefined;

      const allComponents = [];
      for (const row of this.interaction.data.components) {
        allComponents.push(...row.components);
      }

      const component = allComponents.find(c => c.custom_id === customId);
      return component;
    }

    defer(
      type?: 
        | InteractionResponseType.DeferredChannelMessageWithSource
        | InteractionResponseType.DeferredMessageUpdate
    ):
      | APIInteractionResponseDeferredChannelMessageWithSource
      | APIInteractionResponseDeferredMessageUpdate
    {
      return {
        type: type ?? InteractionResponseType.DeferredChannelMessageWithSource,
      }
    }

    reply(data: string | APIInteractionResponseCallbackData): APIInteractionResponseChannelMessageWithSource {
      return {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: typeof data === 'string' ? { content: data } : data,
      }
    }

    updateMessage(data: APIInteractionResponseCallbackData): APIInteractionResponseUpdateMessage {
      return {
        type: InteractionResponseType.UpdateMessage,
        data: typeof data === 'string' ? { content: data } : data,
      }
    }

    modal(data: APIModalInteractionResponseCallbackData): APIModalInteractionResponse {
      return { type: InteractionResponseType.Modal, data }
    }

    premiumRequired(): APIPremiumRequiredInteractionResponse {
      return { type: InteractionResponseType.PremiumRequired }
    }
  }

class InteractionFollowup {
  public client: DiscordApiClient;
  public applicationId: string;
  public interaction: APIInteraction;

  constructor(client: DiscordApiClient, interaction: APIInteraction, applicationId: string) {
    this.client = client;
    this.applicationId = applicationId;
    this.interaction = interaction;
  }

  send(data: string | RESTPostAPIInteractionFollowupJSONBody) {
    return this.client.post(
      Routes.webhook(this.applicationId, this.interaction.token),
      {
        body: typeof data === "string"
          ? { content: data }
          : data,
      },
    ) as Promise<RESTPostAPIInteractionFollowupResult>
  }

  getMessage(messageId: string) {
    return this.client.get(
      Routes.webhookMessage(this.applicationId, this.interaction.token, messageId),
    ) as Promise<RESTGetAPIInteractionFollowupResult>
  }

  editMessage(messageId: string, data: RESTPatchAPIInteractionFollowupJSONBody) {
    return this.client.patch(
      Routes.webhookMessage(this.applicationId, this.interaction.token, messageId),
      { body: data },
    ) as Promise<RESTPatchAPIInteractionFollowupResult>
  }

  deleteMessage(messageId: string) {
    return this.client.delete(
      Routes.webhookMessage(this.applicationId, this.interaction.token, messageId),
    ) as Promise<null>
  }

  getOriginalMessage() {
    return this.getMessage("@original")
  }

  editOriginalMessage(data: RESTPatchAPIInteractionFollowupJSONBody) {
    return this.editMessage("@original", data)
  }

  deleteOriginalMessage() {
    return this.deleteMessage("@original")
  }
}
