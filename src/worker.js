export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api") return env.ASSETS.fetch(request);
    const reply = (value, status = 200) =>
      Response.json(value, {
        status,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    if (request.method !== "POST")
      return reply({ ok: false, error: "Method not allowed." }, 405);
    if (
      request.headers.get("Origin") &&
      request.headers.get("Origin") !== url.origin
    )
      return reply({ ok: false, error: "Access denied." }, 403);
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return reply({ ok: false, error: "JSON required." }, 415);
    if (!env.APPS_SCRIPT_URL || !env.GATEWAY_KEY)
      return reply(
        { ok: false, error: "The live service has not been configured." },
        503,
      );
    try {
      const text = await request.text();
      if (text.length > 16000000)
        return reply({ ok: false, error: "Submission is too large." }, 413);
      const input = JSON.parse(text);
      if (input.action === "enroll" && !input.credential) {
        if (!env.TURNSTILE_SECRET)
          return reply(
            {
              ok: false,
              error: "Submission protection has not been configured.",
            },
            503,
          );
        const checked = await fetch(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          {
            method: "POST",
            body: new URLSearchParams({
              secret: env.TURNSTILE_SECRET,
              response: input.payload?.captcha || "",
              remoteip: request.headers.get("CF-Connecting-IP") || "",
            }),
          },
        );
        const result = await checked.json();
        if (!result.success || result.hostname !== url.hostname)
          return reply(
            { ok: false, error: "Please complete the security check again." },
            400,
          );
      }
      const upstream = await fetch(env.APPS_SCRIPT_URL, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: input.action,
          payload: input.payload,
          credential: input.credential,
          gatewayKey: env.GATEWAY_KEY,
        }),
      });
      if (!upstream.ok)
        return reply(
          {
            ok: false,
            error: "The enrollment service is unavailable. Please retry.",
          },
          502,
        );
      const result = await upstream.json();
      return reply(result, result.ok ? 200 : 400);
    } catch {
      return reply(
        {
          ok: false,
          error: "Unable to reach the enrollment service. Please retry.",
        },
        502,
      );
    }
  },
};
