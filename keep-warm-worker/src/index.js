/**
 * Pings the FLUX backend's /health endpoint on a schedule so Render's free
 * instance never idles out. A cold start costs the next visitor ~50 seconds,
 * which is a poor first impression for anyone opening the deployed site.
 *
 * The fetch is deliberately forgiving: a cold start can legitimately take a
 * minute, and a failed ping is a missed warm-up, not an error worth retrying
 * aggressively. The next trigger is only ten minutes away.
 */

const TIMEOUT_MS = 90_000;

async function ping(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/health`, {
      signal: controller.signal,
      // Skip Cloudflare's cache — a cached 200 would keep reporting success
      // while the origin quietly slept.
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    console.log(`ping ${res.status} ${res.ok ? "awake" : "unexpected status"}`);
    return res.ok;
  } catch (err) {
    console.log(`ping failed: ${err.message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async scheduled(event, env, ctx) {
    // Logged before the fetch so the entry appears even if the ping fails or
    // the request is still in flight — otherwise a silent cron and a broken
    // one look identical in the logs.
    console.log(`cron fired: ${event.cron} at ${new Date().toISOString()}`);
    // Awaited rather than handed to ctx.waitUntil(): the scheduled handler is
    // already allowed to run to completion, and awaiting means the result is
    // logged before the invocation ends.
    await ping(env.FLUX_API_URL);
  },

  // Lets you verify the worker by opening its URL, rather than waiting ten
  // minutes for the next trigger.
  async fetch(request, env) {
    const ok = await ping(env.FLUX_API_URL);
    return new Response(ok ? "Service is awake.\n" : "Ping failed.\n", {
      status: ok ? 200 : 502,
      headers: { "content-type": "text/plain" },
    });
  },
};
