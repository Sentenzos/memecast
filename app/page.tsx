import { PublicChannel } from "./PublicChannel";
import { demoStreamer } from "./memes";

export const dynamic = "force-dynamic";

export default async function Home() {
  let streamer = {
    slug: demoStreamer.slug,
    display_name: demoStreamer.displayName,
    avatar_url: demoStreamer.avatarUrl,
    cooldown_seconds: demoStreamer.cooldownSeconds,
  };
  try {
    const { getDemoStreamer } = await import("../db");
    streamer = await getDemoStreamer();
  } catch {
    // Static fallback keeps the public demo available when D1 is unavailable.
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
