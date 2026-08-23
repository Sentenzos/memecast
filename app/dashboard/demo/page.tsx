import { getDemoStreamer } from "../../../db";
import { DashboardClient } from "../DashboardClient";
import { notFound } from "next/navigation";
import { demoModeEnabled } from "../../demo-mode";

export const dynamic = "force-dynamic";

export default async function DemoDashboardPage() {
  if (!demoModeEnabled()) notFound();
  const streamer = await getDemoStreamer();
  return (
    <DashboardClient
      demoMode
      login="demo"
      initialProfile={{
        displayName: streamer.display_name,
        slug: streamer.slug,
        cooldownSeconds: streamer.cooldown_seconds,
        mediaDisplaySeconds: streamer.media_display_seconds,
        textDisplaySeconds: streamer.text_display_seconds,
        overlayPosition: streamer.overlay_position,
        overlayMediaWidth: streamer.overlay_media_width,
        overlayMediaHeight: streamer.overlay_media_height,
        overlayTextWidth: streamer.overlay_text_width,
        overlayTextHeight: streamer.overlay_text_height,
        overlayTextFontSize: streamer.overlay_text_font_size,
        overlayAnimation: streamer.overlay_animation,
        ttsVoice: streamer.tts_voice,
        overlayToken: streamer.overlay_token,
      }}
    />
  );
}
