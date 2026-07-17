import handler from "vinext/server/app-router-entry";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

const worker = {
  async fetch(
    request: Parameters<typeof handler.fetch>[0],
    env: Parameters<typeof handler.fetch>[1],
    context: Parameters<typeof handler.fetch>[2],
  ) {
    const response = await handler.fetch(request, env, context);
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

export default worker;
