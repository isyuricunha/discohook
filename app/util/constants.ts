import { QueryData } from "~/types/QueryData";

export const WEBHOOK_URL_RE =
  /^https?:\/\/(?:www\.|ptb\.|canary\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d+)\/([\w-]+)$/;

export const MESSAGE_REF_RE =
  /^(?:https:\/\/(?:www\.|ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/)?(\d+)$/;

export const INDEX_MESSAGE: QueryData["messages"][number] = {
  data: {
    content: "Hello, welcome to Boogiehook!",
    embeds: [
      {
        title: "Discohook",
        description: `You may be familiar with this interface from [Discohook](https://discohook.app)! \
This site is not maintained by the original creator of Discohook.`,
      },
    ],
  },
};

export const INDEX_FAILURE_MESSAGE: QueryData["messages"][number] = {
  data: {
    content:
      "The data you loaded this page with was invalid. If you're a developer, [check out the schema](https://github.com/shayypy/boogiehook/blob/master/app/types/QueryData.ts). If you need help, [join the support server](/discord).",
  },
};
