"use client";

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { MemeDefinition } from "./memes";
import { playMemeSound, playMessageSound, preloadMessageSound } from "./sound";
import { configureSpeechUtterance, type TtsVoicePreset } from "./tts";

type Alert = { id: string; createdAt: number; message?: string; viewerName?: string; meme: MemeDefinition };
type OverlaySettings = {
  mediaDisplaySeconds: number;
  textDisplaySeconds: number;
  overlayPosition: "bottom-right" | "bottom-left" | "bottom-center" | "center-right" | "center-left" | "top-right" | "top-left" | "center";
  overlayMediaWidth: number;
  overlayMediaHeight: number;
  overlayTextWidth: number;
  overlayTextHeight: number;
  overlayTextFontSize: number;
  overlayAnimation: "pop" | "slide" | "zoom" | "bounce" | "glitch";
  ttsVoice: TtsVoicePreset;
};
type OverlayState = { queue: Alert[]; active: Alert | null };
type OverlayAction = { type: "enqueue"; alerts: Alert[] } | { type: "complete" };

function overlayReducer(state: OverlayState, action: OverlayAction): OverlayState {
  if (action.type === "enqueue") {
    if (state.active || state.queue.length) {
      return { ...state, queue: [...state.queue, ...action.alerts] };
    }
    const [active = null, ...queue] = action.alerts;
    return { active, queue };
  }
  const [active = null, ...queue] = state.queue;
  return { active, queue };
}

export function OverlayPlayer({ token }: { token: string }) {
  const [{ active }, dispatch] = useReducer(overlayReducer, { queue: [], active: null });
  const [settings, setSettings] = useReducer(
    (current: OverlaySettings, next: Partial<OverlaySettings>) => ({ ...current, ...next }),
    { mediaDisplaySeconds: 5, textDisplaySeconds: 5, overlayPosition: "bottom-right", overlayMediaWidth: 360, overlayMediaHeight: 300, overlayTextWidth: 480, overlayTextHeight: 160, overlayTextFontSize: 28, overlayAnimation: "pop", ttsVoice: "system" },
  );
  const [readyAlertId, setReadyAlertId] = useState<string | null>(null);
  const [hiddenAlertId, setHiddenAlertId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 1920, height: 1080 });
  const cursor = useRef(0);
  const known = useRef(new Set<string>());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadedMedia = useRef(new Map<string, HTMLMediaElement | HTMLImageElement>());

  useEffect(() => {
    let cancelled = false;
    cursor.current = Date.now();
    async function poll() {
      try {
        const after = Math.max(0, cursor.current - 1);
        const response = await fetch(`/api/alerts?token=${encodeURIComponent(token)}&after=${after}`, { cache: "no-store" });
        const result = await response.json() as { alerts?: Alert[]; settings?: Partial<OverlaySettings> };
        if (!response.ok || cancelled) return;
        if (result.settings) setSettings(result.settings);
        const fresh = (result.alerts ?? []).filter((alert) => !known.current.has(alert.id));
        fresh.forEach((alert) => {
          known.current.add(alert.id);
          cursor.current = Math.max(cursor.current, alert.createdAt);
        });
        if (fresh.length) {
          await Promise.all(fresh.map((alert) => warmMedia(alert.meme, preloadedMedia.current)));
          if (!cancelled) dispatch({ type: "enqueue", alerts: fresh });
        }
      } catch {
        // OBS keeps polling after a temporary network interruption.
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 900);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [token]);

  useEffect(() => {
    window.speechSynthesis?.getVoices();
    preloadMessageSound();
  }, []);

  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel("memecast-settings");
    channel.onmessage = (event: MessageEvent<Partial<OverlaySettings>>) => {
      setSettings(event.data);
    };
    return () => channel.close();
  }, []);

  useEffect(() => {
    if (!active) return;
    const alert = active;
    let cancelled = false;
    const currentVideo = videoRef.current;
    const visibilityTimer = alert.message
      ? window.setTimeout(() => setHiddenAlertId(alert.id), settings.textDisplaySeconds * 1000)
      : 0;
    const finish = () => {
      if (!cancelled) {
        void markAlertState(token, alert.id, "completed");
        dispatch({ type: "complete" });
      }
    };

    async function runAlert() {
      void markAlertState(token, alert.id, "started");
      const isSilentImage = alert.meme.mediaUrl && alert.meme.mediaType === "image";
      if (isSilentImage) {
        const display = wait(settings.mediaDisplaySeconds * 1000);
        if (hasMessageSound(alert.meme)) await playMessageSound();
        if (alert.message) {
          await Promise.all([display, speak(alert.message, settings.ttsVoice)]);
        } else {
          await display;
        }
        finish();
        return;
      }

      if (alert.meme.mediaUrl) {
        await playMedia(alert.meme.mediaUrl, alert.meme.mediaType ?? "video");
      } else if (alert.meme.id.startsWith("text:")) {
        await playMessageSound();
      } else {
        playMemeSound(alert.meme.sound);
        await wait(alert.meme.sound === "video" ? 500 : 3600);
      }
      if (alert.message) {
        await speak(alert.message, settings.ttsVoice);
      }
      finish();
    }

    function playMedia(url: string, mediaType: MemeDefinition["mediaType"]) {
      if (mediaType === "image") return wait(settings.mediaDisplaySeconds * 1000);
      if (mediaType === "audio") {
        const warmed = preloadedMedia.current.get(url);
        const audio = warmed instanceof HTMLAudioElement ? warmed : new Audio(url);
        audio.currentTime = 0;
        audio.preload = "auto";
        audioRef.current = audio;
        return mediaPromise(audio, settings.mediaDisplaySeconds * 1000, () => setReadyAlertId(alert.id));
      }
      return new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          if (!currentVideo) {
            resolve();
            return;
          }
          mediaPromise(currentVideo, settings.mediaDisplaySeconds * 1000, () => setReadyAlertId(alert.id)).then(resolve);
        });
      });
    }

    void runAlert();
    return () => {
      cancelled = true;
      window.clearTimeout(visibilityTimer);
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();
      currentVideo?.pause();
    };
  }, [active, settings.mediaDisplaySeconds, settings.textDisplaySeconds, settings.ttsVoice, token]);

  const waitsForPlayableMedia = Boolean(active?.meme.mediaUrl && active.meme.mediaType !== "image");
  const mediaReady = !active || !waitsForPlayableMedia || readyAlertId === active.id;
  const isTextOnlyAlert = Boolean(active?.meme.id.startsWith("text:"));
  const visibleTextWidth = Math.min(settings.overlayTextWidth, Math.max(1, viewport.width - 88));
  const visibleTextHeight = Math.min(settings.overlayTextHeight, Math.max(1, viewport.height - 88));
  const visibleAlertWidth = Math.min(Math.max(visibleTextWidth, settings.overlayMediaWidth), Math.max(1, viewport.width - 88));
  const senderHeight = active?.viewerName ? 19 : 0;
  const availableMessageHeight = Math.max(12, visibleTextHeight - 26 - senderHeight);
  const visibleFontSize = Math.max(10, Math.min(settings.overlayTextFontSize, Math.floor(availableMessageHeight / 1.12)));

  return (
    <main className="overlay-stage" aria-live="assertive">
      {active ? (
        <div
          aria-hidden={hiddenAlertId === active.id}
          className={`overlay-alert overlay-animation-${settings.overlayAnimation} ${mediaReady ? "overlay-media-ready" : "overlay-media-loading"} ${hiddenAlertId === active.id ? "overlay-visual-hidden" : ""} overlay-pos-${settings.overlayPosition} ${active.meme.mediaUrl ? "overlay-file-alert" : "overlay-built-in-alert"} ${active.message ? "overlay-with-text" : active.viewerName ? "overlay-with-sender" : ""} tone-${active.meme.tone}`}
          key={active.id}
          style={active.message ? { width: `${visibleAlertWidth}px` } : undefined}
        >
          {active.meme.mediaUrl ? (
            <div className="overlay-file">
              {active.meme.mediaType === "image" ? (
                <img className="overlay-media" src={active.meme.mediaUrl} alt="" style={{ maxWidth: `${settings.overlayMediaWidth}px`, maxHeight: `${settings.overlayMediaHeight}px` }} />
              ) : active.meme.mediaType !== "audio" ? (
                // User-uploaded videos do not include captions.
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video ref={videoRef} className="overlay-media" src={active.meme.mediaUrl} autoPlay playsInline preload="auto" onCanPlay={() => setReadyAlertId(active.id)} onPlaying={() => setReadyAlertId(active.id)} style={{ maxWidth: `${settings.overlayMediaWidth}px`, maxHeight: `${settings.overlayMediaHeight}px` }} />
              ) : null}
            </div>
          ) : !isTextOnlyAlert ? (
            <div className="overlay-sticker"><span aria-hidden="true">{active.meme.emoji}</span></div>
          ) : null}
          {active.message || active.viewerName || !active.meme.mediaUrl ? (
            <div
              className={`overlay-text ${!active.message && active.viewerName ? "overlay-sender-only" : ""}`}
              style={active.message ? { maxWidth: `${visibleTextWidth}px`, maxHeight: `${visibleTextHeight}px` } : undefined}
            >
              {active.viewerName ? <span>{active.viewerName}</span> : null}
              {active.message ? (
                <FittedOverlayMessage
                  fontSize={visibleFontSize}
                  layoutKey={`${visibleTextWidth}:${visibleTextHeight}:${active.viewerName ?? ""}`}
                  text={active.message}
                />
              ) : !active.meme.mediaUrl ? <strong>{active.meme.title}</strong> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function FittedOverlayMessage({ text, fontSize, layoutKey }: { text: string; fontSize: number; layoutKey: string }) {
  const elementRef = useRef<HTMLElement | null>(null);
  const [visibleText, setVisibleText] = useState(text);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let frame = 0;
    const fitText = () => {
      const symbols = Array.from(text);
      const fits = (candidate: string) => {
        element.textContent = candidate;
        return element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
      };

      let nextText = text;
      if (!fits(text)) {
        let low = 0;
        let high = symbols.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          const candidate = `${symbols.slice(0, middle).join("").trimEnd()}…`;
          if (fits(candidate)) low = middle;
          else high = middle - 1;
        }
        nextText = `${symbols.slice(0, low).join("").trimEnd()}…`;
      }
      element.textContent = nextText;
      setVisibleText((current) => current === nextText ? current : nextText);
    };

    frame = window.requestAnimationFrame(fitText);
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(fitText);
    });
    if (element.parentElement) observer.observe(element.parentElement);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fontSize, layoutKey, text]);

  return <strong ref={elementRef} style={{ fontSize: `${fontSize}px` }}>{visibleText}</strong>;
}

function hasMessageSound(meme: MemeDefinition) {
  return meme.sourceType === "gif" || meme.sourceType === "sticker" || meme.subtitle === "GIF" || meme.subtitle === "STICKER";
}

async function markAlertState(token: string, alertId: string, state: "started" | "completed") {
  try {
    await fetch("/api/overlay-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, alertId, state }),
      keepalive: true,
    });
  } catch {
    // Playback must continue even if the status endpoint is briefly unavailable.
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function mediaPromise(element: HTMLMediaElement, fallbackMs: number, onPlaying?: () => void) {
  return new Promise<void>((resolve) => {
    let done = false;
    let playbackTimer = 0;
    let startupTimer = 0;
    const complete = () => {
      if (done) return;
      done = true;
      window.clearTimeout(startupTimer);
      window.clearTimeout(playbackTimer);
      element.removeEventListener("ended", complete);
      element.removeEventListener("error", complete);
      element.removeEventListener("playing", started);
      resolve();
    };
    const started = () => {
      onPlaying?.();
      window.clearTimeout(startupTimer);
      playbackTimer = window.setTimeout(complete, fallbackMs);
    };
    element.addEventListener("ended", complete, { once: true });
    element.addEventListener("error", complete, { once: true });
    element.addEventListener("playing", started, { once: true });
    startupTimer = window.setTimeout(complete, 8000);
    void element.play().catch(complete);
  });
}

function warmMedia(meme: MemeDefinition, cache: Map<string, HTMLMediaElement | HTMLImageElement>) {
  const url = meme.mediaUrl;
  if (!url || cache.has(url)) return Promise.resolve();
  if (meme.mediaType === "image") {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    cache.set(url, image);
    return readyPromise(image, ["load", "error"], 900);
  }
  const media = document.createElement(meme.mediaType === "audio" ? "audio" : "video");
  media.preload = "auto";
  media.src = url;
  media.load();
  cache.set(url, media);
  return readyPromise(media, ["canplay", "error"], 1400);
}

function readyPromise(target: EventTarget, events: string[], timeoutMs: number) {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      events.forEach((event) => target.removeEventListener(event, finish));
      window.clearTimeout(timer);
      resolve();
    };
    events.forEach((event) => target.addEventListener(event, finish, { once: true }));
    const timer = window.setTimeout(finish, timeoutMs);
  });
}

function speak(text: string, voicePreset: TtsVoicePreset) {
  return new Promise<void>((resolve) => {
    const synthesis = Reflect.get(window, "speechSynthesis") as SpeechSynthesis | undefined;
    if (!synthesis) {
      window.setTimeout(resolve, Math.min(7000, 900 + text.length * 45));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    configureSpeechUtterance(utterance, synthesis.getVoices(), voicePreset, /[а-яё]/i.test(text) ? "ru-RU" : "en-US");
    let settled = false;
    const watchdog = window.setTimeout(complete, Math.min(120000, Math.max(30000, text.length * 600)));
    function complete() {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      resolve();
    }
    utterance.onend = complete;
    utterance.onerror = complete;
    synthesis.cancel();
    synthesis.speak(utterance);
  });
}
