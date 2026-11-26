import env from "$lib/env";
import { get } from "svelte/store";
import settings from "$lib/state/settings";
import { browser } from "$app/environment";

const apiBase = (raw: string) => {
    // Relative path (local vite proxy): always same-origin as the page
    // so http://localhost:5173 and http://127.0.0.1:5173 both work.
    if (raw.startsWith("/")) {
        const path = raw.replace(/\/+$/, "") || "";
        if (browser) {
            return `${window.location.origin}${path}`;
        }
        return `http://127.0.0.1:5173${path}`;
    }

    const parsed = new URL(raw);
    const path = parsed.pathname.replace(/\/+$/, "");
    return path && path !== "/" ? `${parsed.origin}${path}` : parsed.origin;
};

export const currentApiURL = () => {
    const processingSettings = get(settings).processing;
    const customInstanceURL = processingSettings.customInstanceURL;

    if (processingSettings.enableCustomInstances && customInstanceURL.length > 0) {
        return apiBase(customInstanceURL);
    }

    return apiBase(env.DEFAULT_API!);
};

/** Rewrite local API tunnel URLs through the vite proxy (same-origin). */
export const localizeMediaURL = (url: string) => {
    if (!browser) return url;
    try {
        const parsed = new URL(url);
        const isLocalApi =
            (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
            parsed.port === "9000";
        if (!isLocalApi) return url;
        return `${window.location.origin}/cobalt-api${parsed.pathname}${parsed.search}`;
    } catch {
        return url;
    }
};
