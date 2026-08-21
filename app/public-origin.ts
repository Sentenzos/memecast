export function publicOrigin(request: Request) {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("APP_URL must use http or https");
    return url.origin;
  }

  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedProto && forwardedHost && /^(https?|http)$/.test(forwardedProto)) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return requestUrl.origin;
}
