import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStreamerBySlug } from "../../../db";
import { PublicChannel } from "../../PublicChannel";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const streamer = await getStreamerBySlug(slug);
  if (!streamer) return { title: "Стример не найден — MemeCast" };
  const title = `${streamer.display_name} — мемы на стрим | MemeCast`;
  const description = `Отправь бесплатный мем-алерт стримеру ${streamer.display_name}.`;
  return {
    title,
    description,
    openGraph: { title, description, images: [] },
    twitter: { card: "summary", title, description, images: [] },
  };
}

export default async function StreamerPage({ params }: Props) {
  const { slug } = await params;
  const streamer = await getStreamerBySlug(slug);
  if (!streamer) notFound();
  return <PublicChannel slug={streamer.slug} displayName={streamer.display_name} avatarUrl={streamer.avatar_url} cooldownSeconds={streamer.cooldown_seconds} />;
}
