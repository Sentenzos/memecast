"use client";

/* eslint-disable @next/next/no-img-element */

import type Hls from "hls.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BroadcastState = {
  live: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  artworkDataUrl: string | null;
  positionMs: number;
  durationMs: number;
  sourceUpdatedAt: number;
  hlsUrl: string;
};

export function MusicBroadcastPlayer({ slug }: { slug: string }) {
  const [broadcast, setBroadcast] = useState<BroadcastState | null>(null);
  const [listening, setListening] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const audioRef = useRef<HTMLAudioElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const stopListening = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setListening(false);
    setConnecting(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch(`/api/broadcast-state?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (!response.ok) return;
        const next = await response.json() as BroadcastState;
        if (!cancelled) {
          setBroadcast(next);
          if (!next.live) stopListening();
        }
      } catch {
        // A missed poll must not tear down a stream that is still playing.
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [slug, stopListening]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => hlsRef.current?.destroy(), []);

  useEffect(() => {
    const stored = window.localStorage.getItem(`memecast-volume:${slug}`);
    if (stored === null) return;
    const saved = Number(stored);
    if (!Number.isFinite(saved) || saved < 0 || saved > 1) return;
    const frame = window.requestAnimationFrame(() => setVolume(saved));
    return () => window.cancelAnimationFrame(frame);
  }, [slug]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  function changeVolume(nextVolume: number) {
    setVolume(nextVolume);
    window.localStorage.setItem(`memecast-volume:${slug}`, String(nextVolume));
  }

  const positionMs = useMemo(() => {
    if (!broadcast?.live) return 0;
    const drift = Math.max(0, clock - broadcast.sourceUpdatedAt);
    return Math.min(broadcast.durationMs || Number.MAX_SAFE_INTEGER, broadcast.positionMs + drift);
  }, [broadcast, clock]);

  async function togglePlayback() {
    if (listening || connecting) {
      stopListening();
      return;
    }
    const audio = audioRef.current;
    if (!audio || !broadcast?.live) return;
    setConnecting(true);
    setError("");
    try {
      const { default: Hls } = await import("hls.js");
      if (Hls.isSupported()) {
        const hls = new Hls({
          lowLatencyMode: true,
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 5,
          enableWorker: true,
        });
        hlsRef.current = hls;
        hls.attachMedia(audio);
        await new Promise<void>((resolve, reject) => {
          hls.once(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(broadcast.hlsUrl));
          hls.once(Hls.Events.MANIFEST_PARSED, () => resolve());
          hls.once(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) reject(new Error(data.details));
          });
        });
      } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
        audio.src = broadcast.hlsUrl;
      } else {
        throw new Error("Этот браузер не поддерживает live-аудио");
      }
      await audio.play();
      setListening(true);
    } catch (cause) {
      stopListening();
      setError(cause instanceof Error ? cause.message : "Не удалось подключиться к эфиру");
    } finally {
      setConnecting(false);
    }
  }

  if (!broadcast?.live) return null;
  const progress = broadcast.durationMs > 0 ? Math.min(100, positionMs / broadcast.durationMs * 100) : 0;

  return (
    <section className="music-broadcast" aria-label="Музыка стримера">
      {/* The element carries a live music stream; timed captions do not exist for it. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} onEnded={() => setListening(false)} />
      <div className="music-art" aria-hidden="true">
        {broadcast.artworkDataUrl ? <img src={broadcast.artworkDataUrl} alt="" /> : <span>♫</span>}
      </div>
      <button className={`music-play ${listening ? "music-play-active" : ""}`} type="button" onClick={togglePlayback} aria-label={listening ? "Остановить музыку" : "Слушать прямой эфир"}>
        {connecting ? <span className="music-loader" /> : listening ? "■" : "▶"}
      </button>
      <div className="music-copy">
        <div className="music-live-label"><span /> В ЭФИРЕ СЕЙЧАС</div>
        <strong>{broadcast.title}</strong>
        <small>{broadcast.artist}{broadcast.album ? ` · ${broadcast.album}` : ""}</small>
        <div className="music-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      </div>
      <div className="music-controls">
        <div className="music-status">
          <span className={listening ? "music-waves music-waves-active" : "music-waves"}><i /><i /><i /></span>
          {listening ? "Слушаете live" : "Нажмите Play"}
        </div>
        <label className="music-volume">
          <span aria-hidden="true">{volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}</span>
          <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => changeVolume(Number(event.target.value))} aria-label="Громкость музыки" />
          <output>{Math.round(volume * 100)}%</output>
        </label>
      </div>
      {error ? <p className="music-error">Поток ещё запускается. Попробуйте снова через несколько секунд.</p> : null}
    </section>
  );
}
