import { get } from "svelte/store";

import settings from "$lib/state/settings";

import { getSession, resetSession } from "$lib/api/session";
import { currentApiURL, localizeMediaURL } from "$lib/api/api-url";
import { turnstileEnabled, turnstileSolved } from "$lib/state/turnstile";
import cachedInfo from "$lib/state/server-info";
import { getServerInfo } from "$lib/api/server-info";

import type { Optional } from "$lib/types/generic";
import type { CobaltAPIResponse, CobaltErrorResponse, CobaltSaveRequestBody } from "$lib/types/api";

const waitForTurnstile = async () => {
    return await new Promise((resolve, reject) => {
        const unsub = turnstileSolved.subscribe((solved) => {
            if (solved) {
                unsub();
                resolve(true);
            }
        });

        // wait for turnstile to finish for 15 seconds
        setTimeout(() => {
            unsub();
            reject(false);
        }, 15 * 1000)
    });
}

const getAuthorization = async () => {
    const processing = get(settings).processing;
    if (processing.enableCustomApiKey && processing.customApiKey.length > 0) {
        return `Api-Key ${processing.customApiKey}`;
    }

    if (!get(turnstileEnabled)) {
        return;
    }

    if (!get(turnstileSolved)) {
        try {
            await waitForTurnstile();
        } catch {
            return {
                status: "error",
                error: {
                    code: "error.captcha_too_long"
                }
            } as CobaltErrorResponse;
        }
    }

    const session = await getSession();

    if (session) {
        if ("error" in session) {
            if (session.error.code !== "error.api.auth.not_configured") {
                return session;
            }
        } else {
            return `Bearer ${session.token}`;
        }
    }
}

const request = async (requestBody: CobaltSaveRequestBody, justRetried = false) => {
    await getServerInfo();

    const getCachedInfo = get(cachedInfo);

    if (!getCachedInfo) {
        return {
            status: "error",
            error: {
                code: "error.api.unreachable"
            }
        } as CobaltErrorResponse;
    }

    const api = `${currentApiURL()}/`;
    const authorization = await getAuthorization();

    if (authorization && typeof authorization !== "string") {
        return authorization;
    }

    let extraHeaders = {};

    if (authorization) {
        extraHeaders = {
            "Authorization": authorization
        }
    }

    const response: Optional<CobaltAPIResponse> = await fetch(api, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify(requestBody),
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            ...extraHeaders,
        },
    })
    .then(r => r.json())
    .catch((e) => {
        if (e?.message?.includes("timed out")) {
            return {
                status: "error",
                error: {
                    code: "error.api.timed_out"
                }
            } as CobaltErrorResponse;
        }
    });

    if (
        response?.status === 'error'
            && response?.error.code === 'error.api.auth.jwt.invalid'
            && !justRetried
    ) {
        resetSession();
        await getAuthorization();
        return request(requestBody, true);
    }

    // Prefer same-origin proxy for local tunnel/redirect/picker URLs
    if (response && typeof response === "object") {
        if ("url" in response && typeof response.url === "string") {
            response.url = localizeMediaURL(response.url);
        }
        if ("tunnel" in response && Array.isArray(response.tunnel)) {
            response.tunnel = response.tunnel.map(localizeMediaURL);
        }
        if ("audio" in response && typeof response.audio === "string") {
            response.audio = localizeMediaURL(response.audio);
        }
        if ("picker" in response && Array.isArray(response.picker)) {
            response.picker = response.picker.map((item) => ({
                ...item,
                url: item.url ? localizeMediaURL(item.url) : item.url,
                thumb: item.thumb ? localizeMediaURL(item.thumb) : item.thumb,
            }));
        }
    }

    return response;
}

const probeCobaltTunnel = async (url: string) => {
    const request = await fetch(`${localizeMediaURL(url)}&p=1`).catch(() => {});
    if (request?.status === 200) {
        return request?.status;
    }
    return 0;
}

export default {
    request,
    probeCobaltTunnel,
}
