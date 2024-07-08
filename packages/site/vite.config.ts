import {
  cloudflareDevProxyVitePlugin,
  vitePlugin as remix,
} from "@remix-run/dev";
import fs from "node:fs/promises";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const pathify = (filename: string) =>
  filename
    // Remove file extension
    .replace(/\.(?:ts|js|md)x?$/, "")
    // Path separators
    .replace(/([^[])\.([^\]])/g, "$1/$2")
    // Config routes require colons instead of dollar signs, for some reason
    // Doesn't support splat routes but we don't currently have any of those
    .replace(/([^[])\$([^\]])/g, "$1:$2")
    // Literal placeholders
    .replace(/\[(.+)\]/, "$1");

const getRouteFilenames = async (dir: string) => {
  return (await fs.readdir(dir)).filter(
    (f) =>
      [".ts", ".tsx", ".js", ".jsx", ".mdx"].filter((e) => f.endsWith(e))
        .length !== 0,
  );
};

export default defineConfig({
  plugins: [
    cloudflareDevProxyVitePlugin({
      // getLoadContext: ({ request, context }) => {
      //   return {
      //     ...context,
      //     env: context.cloudflare.env as Env,
      //     origin: new URL(request.url).origin,
      //   };
      // },
      persist: { path: "../../persistence" },
    }),
    remix({
      ignoredRouteFiles: ["**/.*"],
      routes: async (defineRoutes) => {
        const filesV1 = await getRouteFilenames("./app/api/v1");
        return defineRoutes((route) => {
          for (const file of filesV1) {
            route(`/api/v1/${pathify(file)}`, `api/v1/${file}`);
          }
        });
      },
    }),
    tsconfigPaths(),
  ],
  ssr: {
    resolve: {
      conditions: ["workerd", "worker", "browser"],
    },
  },
  resolve: {
    mainFields: ["browser", "module", "main"],
  },
  build: {
    minify: true,
  },
});
