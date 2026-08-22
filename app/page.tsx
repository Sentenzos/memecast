import { PublicChannel } from "./PublicChannel";

export const dynamic = "force-dynamic";

export default async function Home() {
  const fallbackName = process.env.ADMIN_LOGIN?.trim() || "Стример";
  let streamer = {
    slug: "streamer",
    display_name: fallbackName,
    avatar_url: null as string | null,
    cooldown_seconds: 30,
  };
  try {
    const { ensureStreamerForOwner } = await import("../db");
    streamer = await ensureStreamerForOwner("env-admin", fallbackName);
  } catch {
    // The public page still renders if persistent storage is temporarily unavailable.
  }
  return (
    <PublicChannel
      slug={streamer.slug}
      displayName={streamer.display_name}
      avatarUrl={streamer.avatar_url}
      cooldownSeconds={streamer.cooldown_seconds}
    />
  );
}
