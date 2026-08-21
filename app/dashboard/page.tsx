import { requireAdminUser } from "../admin-auth";
import { ensureStreamerForOwner } from "../../db";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireAdminUser("/dashboard");
  const streamer = await ensureStreamerForOwner(user.userId, user.displayName);
  return (
    <DashboardClient
      login={user.login}
      initialProfile={{
        displayName: streamer.display_name,
        slug: streamer.slug,
        cooldownSeconds: streamer.cooldown_seconds,
        mediaDisplaySeconds: streamer.media_display_seconds,
        textDisplaySeconds: streamer.text_display_seconds,
        overlayPosition: streamer.overlay_position,
        overlayMediaWidth: streamer.overlay_media_width,
        overlayMediaHeight: streamer.overlay_media_height,
        overlayAnimation: streamer.overlay_animation,
        overlayToken: streamer.overlay_token,
      }}
    />
  );
}
