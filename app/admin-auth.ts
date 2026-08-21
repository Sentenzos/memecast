import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type AdminUser = {
  userId: string;
  login: string;
  displayName: string;
};

const SESSION_COOKIE = "memecast-admin-session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function adminCredentialsConfigured() {
  return Boolean(credentials());
}

export async function authenticateAdmin(login: string, password: string) {
  const configured = credentials();
  if (!configured) return false;
  const [loginMatches, passwordMatches] = await Promise.all([
    constantTimeTextEqual(login.trim(), configured.login),
    constantTimeTextEqual(password, configured.password),
  ]);
  return loginMatches && passwordMatches;
}

export async function getAdminUser(): Promise<AdminUser | null> {
  const configured = credentials();
  if (!configured) return null;
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  return session ? verifySession(session, configured) : null;
}

export async function createAdminSession() {
  const configured = credentials();
  if (!configured) throw new Error("ADMIN_LOGIN and ADMIN_PASSWORD must be configured");
  const user = adminUser(configured.login);
  const payload = Buffer.from(JSON.stringify({ ...user, expiresAt: Date.now() + SESSION_MAX_AGE * 1000 })).toString("base64url");
  const signature = await sign(payload, configured.password);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, `${payload}.${signature}`, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function requireAdminUser(returnTo: string): Promise<AdminUser> {
  const user = await getAdminUser();
  if (user) return user;
  redirect(`/login?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`);
}

export function safeRelativeReturnPath(value: string | null | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/dashboard";
  try {
    const url = new URL(value, "https://app.local");
    return url.origin === "https://app.local" ? `${url.pathname}${url.search}${url.hash}` : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

async function verifySession(value: string, configured: { login: string; password: string }): Promise<AdminUser | null> {
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = await sign(payload, configured.password);
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AdminUser & { expiresAt?: number };
    if (parsed.userId !== "env-admin" || parsed.login !== configured.login || !parsed.expiresAt || parsed.expiresAt < Date.now()) return null;
    return adminUser(configured.login);
  } catch {
    return null;
  }
}

function credentials() {
  const login = process.env.ADMIN_LOGIN?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (login && password) return { login, password };
  if (process.env.NODE_ENV !== "production") return { login: "admin", password: "admin" };
  return null;
}

function secureCookies() {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      return new URL(appUrl).protocol === "https:";
    } catch {
      return process.env.NODE_ENV === "production";
    }
  }
  return process.env.NODE_ENV === "production";
}

function adminUser(login: string): AdminUser {
  return { userId: "env-admin", login, displayName: login };
}

async function sign(value: string, password: string) {
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`memecast-admin-session:${password}`));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Buffer.from(signature).toString("base64url");
}

async function constantTimeTextEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  return constantTimeEqual(Buffer.from(leftHash).toString("hex"), Buffer.from(rightHash).toString("hex"));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
