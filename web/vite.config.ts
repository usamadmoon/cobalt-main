import mime from "mime";
import basicSSL from "@vitejs/plugin-basic-ssl";

import { glob } from "glob";
import { sveltekit } from "@sveltejs/kit/vite";
import { createSitemap } from "svelte-sitemap/src/index";
import { defineConfig, searchForWorkspaceRoot, type PluginOption } from "vite";

import { join, basename } from "node:path";
import { createReadStream } from "node:fs";
import { cp, readdir, mkdir } from "node:fs/promises";

const exposeLibAV: PluginOption = (() => {
    const IMPUT_MODULE_DIR = join(__dirname, 'node_modules/@imput');
    return {
        name: "vite-libav.js",
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                if (!req.url?.startsWith('/_libav/')) return next();

                const filename = basename(req.url).split('?')[0];
                if (!filename) return next();

                const [file] = await glob(join(IMPUT_MODULE_DIR, '/**/dist/', filename));
                if (!file) return next();

                const fileType = mime.getType(filename);
                if (!fileType) return next();

                res.setHeader('Content-Type', fileType);
                return createReadStream(file).pipe(res);
            });
        },
        generateBundle: async (options) => {
            if (!options.dir) {
                return;
            }

            const assets = join(options.dir, '_libav');
            await mkdir(assets, { recursive: true });

            const modules = await readdir(IMPUT_MODULE_DIR).then(
                modules => modules.filter(m => m.startsWith('libav.js'))
            );

            for (const module of modules) {
                const distFolder = join(IMPUT_MODULE_DIR, module, 'dist/');
                await cp(distFolder, assets, { recursive: true });
            }
        }
    }
})();

const enableCOEP: PluginOption = {
    name: "isolation",
    configureServer(server) {
        server.middlewares.use((_req, res, next) => {
            res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
            res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
            next();
        })
    }
};

const generateSitemap: PluginOption = {
    name: "generate-sitemap",
    async writeBundle(bundle) {
        if (!process.env.WEB_HOST || !bundle.dir?.endsWith('server')) {
            return;
        }

        await createSitemap(`https://${process.env.WEB_HOST}`, {
            changeFreq: 'monthly',
            outDir: '.svelte-kit/output/prerendered/pages',
            resetTime: true
        });
    }
}

const checkDefaultApiEnv = (): PluginOption => ({
    name: "check-default-api",
    config() {
        if (!process.env.WEB_DEFAULT_API) {
            throw new Error(
                "WEB_DEFAULT_API env variable is required, but missing."
            );
        }
    },
});

// Local HTTP mode: UI must be http:// when talking to a local http:// API,
// otherwise the browser blocks mixed content. API is reached via same-origin
// /cobalt-api proxy, so COEP can stay enabled.
const localHttp = ["1", "true"].includes(
    (process.env.WEB_LOCAL_HTTP || "").toLowerCase()
);

export default defineConfig({
    plugins: [
        checkDefaultApiEnv(),
        ...(localHttp ? [] : [basicSSL()]),
        sveltekit(),
        enableCOEP,
        exposeLibAV,
        generateSitemap
    ],
    build: {
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks: (id) => {
                    if (id.includes('/web/i18n') && id.endsWith('.json')) {
                        const lang = id.split('/web/i18n/')?.[1].split('/')?.[0];
                        if (lang) {
                            return `i18n_${lang}`;
                        }
                    }
                }
            }
        }
    },
    server: {
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
        },
        fs: {
            allow: [
                searchForWorkspaceRoot(process.cwd())
            ]
        },
        // Same-origin proxy so the UI talks to our local API (10h limit)
        // without cross-port browser restrictions.
        proxy: localHttp
            ? {
                  "/cobalt-api": {
                      target: "http://127.0.0.1:9000",
                      changeOrigin: true,
                      rewrite: (path) => path.replace(/^\/cobalt-api/, "") || "/",
                      // Important for media tunnels
                      configure: (proxy) => {
                          proxy.on("proxyRes", (proxyRes) => {
                              // Ensure CORP so COEP pages can read proxied media if needed
                              proxyRes.headers["cross-origin-resource-policy"] =
                                  "cross-origin";
                          });
                      },
                  },
              }
            : {},
        ...(localHttp
            ? {
                  https: false,
                  host: "0.0.0.0",
                  port: 5173,
              }
            : {}),
    },
    optimizeDeps: {
        exclude: ["@imput/libav.js-remux-cli"]
    },
});
