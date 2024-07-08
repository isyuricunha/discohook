import { getAssetFromKV } from "@cloudflare/kv-asset-handler";
import { createRequestHandler } from "@remix-run/cloudflare";
import * as remixBuild from "./build/server";

// eslint-disable-next-line import/no-unresolved
import __STATIC_CONTENT_MANIFEST from "__STATIC_CONTENT_MANIFEST";

export { DurableComponentState } from "store";
export { DurableDraftComponentCleaner } from "./app/durable/draft-components";
export { DurableScheduler } from "./app/durable/scheduler";

// export class BasicDurableObject extends DurableObject {
//   constructor(state, env) {
//     super();
//   }

//   async fetch(request) {
//     return new Response(undefined, { status: 204 });
//   }
// }

const MANIFEST = JSON.parse(__STATIC_CONTENT_MANIFEST);
const handleRemixRequest = createRequestHandler(remixBuild);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      const ttl = url.pathname.startsWith("/assets/")
        ? 60 * 60 * 24 * 365 // 1 year
        : 60 * 5; // 5 minutes
      return await getAssetFromKV(
        {
          request,
          waitUntil: ctx.waitUntil.bind(ctx),
        },
        {
          ASSET_NAMESPACE: env.__STATIC_CONTENT,
          ASSET_MANIFEST: MANIFEST,
          cacheControl: {
            browserTTL: ttl,
            edgeTTL: ttl,
          },
        },
      );
    } catch (error) {
      // No-op
    }

    try {
      const loadContext = {
        cloudflare: {
          // This object matches the return value from Wrangler's
          // `getPlatformProxy` used during development via Remix's
          // `cloudflareDevProxyVitePlugin`:
          // https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy
          cf: request.cf,
          ctx: {
            waitUntil: ctx.waitUntil,
            passThroughOnException: ctx.passThroughOnException,
          },
          caches,
          env,
        },
      };
      const response = await handleRemixRequest(request, loadContext);
      if (
        request.url.startsWith(`${url.origin}/api/`) &&
        !response.headers.get("Content-Type")?.startsWith("application/json")
      ) {
        response.headers.delete("Content-Type");
        if (response.status === 404) {
          return json(
            { message: "Not Found" },
            {
              status: 404,
              headers: response.headers,
            },
          );
        }
      }
      return response;
    } catch (error) {
      console.log(error);
      return new Response("An unexpected error occurred", { status: 500 });
    }
  },
};
