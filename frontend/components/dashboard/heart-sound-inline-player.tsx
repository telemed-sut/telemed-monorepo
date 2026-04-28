"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import {
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Volume1,
  Volume2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface HeartSoundInlinePlayerProps {
  src: string;
  isActive: boolean;
  onRequestPlay: () => void;
  onPlaybackStop: () => void;
  className?: string;
}

export function HeartSoundInlinePlayer({
  src,
  isActive,
  onRequestPlay,
  onPlaybackStop,
  className,
}: HeartSoundInlinePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const volumePanelRef = useRef<HTMLDivElement | null>(null);
  const volumeCloseTimeoutRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(1);
  const [volumePanelOpen, setVolumePanelOpen] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || isActive) {
      return;
    }

    if (!audio.paused) {
      audio.pause();
    }
  }, [isActive]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!volumePanelOpen) {
        return;
      }

      const target = event.target as Node | null;
      if (target && volumePanelRef.current?.contains(target)) {
        return;
      }

      setVolumePanelOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [volumePanelOpen]);

  useEffect(() => {
    return () => {
      if (volumeCloseTimeoutRef.current) {
        window.clearTimeout(volumeCloseTimeoutRef.current);
      }
    };
  }, []);

  const handleTogglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      setIsBuffering(false);
      onPlaybackStop();
      return;
    }

    onRequestPlay();
    setIsBuffering(true);

    try {
      await audio.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
      setIsBuffering(false);
      onPlaybackStop();
    }
  };

  const handleVolumeChange = (nextVolume: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = nextVolume;
    }
    setVolumeLevel(nextVolume);

    if (volumeCloseTimeoutRef.current) {
      window.clearTimeout(volumeCloseTimeoutRef.current);
    }
    volumeCloseTimeoutRef.current = window.setTimeout(() => {
      setVolumePanelOpen(false);
    }, 700);
  };

  const progressPercent =
    duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
  const volumePercent = Math.round(volumeLevel * 100);

  return (
    <div
      className={cn(
        "rounded-[12px] border border-slate-200/80 bg-white px-3 py-3 shadow-[0_8px_18px_rgba(15,23,42,0.04)]",
        className,
      )}
    >
      <audio
        ref={audioRef}
        preload="metadata"
        src={src}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          event.currentTarget.volume = volumeLevel;
        }}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
        }}
        onPlay={() => {
          setIsPlaying(true);
        }}
        onPause={() => {
          setIsPlaying(false);
          setIsBuffering(false);
        }}
        onWaiting={() => {
          setIsBuffering(true);
        }}
        onPlaying={() => {
          setIsBuffering(false);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setIsBuffering(false);
          setCurrentTime(0);
          onPlaybackStop();
        }}
      />

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className={cn(
            "shrink-0 rounded-full border-sky-200 bg-sky-50 text-sky-950 shadow-none hover:border-sky-300 hover:bg-sky-100 hover:text-sky-950",
            isPlaying && "border-sky-300 bg-sky-100 text-sky-950",
          )}
          onClick={handleTogglePlayback}
          aria-label={isPlaying ? "Pause audio" : "Play audio"}
        >
          {isBuffering ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="ml-0.5 size-3.5" />
          )}
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="min-w-[74px] text-xs font-medium tabular-nums text-slate-500">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={(event) => {
                const nextTime = Number(event.target.value);
                const audio = audioRef.current;
                if (!audio) {
                  return;
                }
                audio.currentTime = nextTime;
                setCurrentTime(nextTime);
              }}
              className="heart-sound-progress-minimal h-2 w-full cursor-pointer appearance-none rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200"
              style={{ "--progress": `${progressPercent}%` } as CSSProperties}
              aria-label="Seek audio playback"
            />

            <div ref={volumePanelRef} className="relative">
              {volumePanelOpen ? (
                <div className="absolute bottom-full right-0 z-30 mb-2 w-[220px] rounded-2xl border border-slate-200 bg-white p-3 text-slate-900 shadow-[0_18px_40px_rgba(15,23,42,0.16)]">
                  <div className="flex items-center gap-2">
                    <Volume1 className="size-4 shrink-0 text-slate-500" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={volumeLevel}
                      onChange={(event) => {
                        handleVolumeChange(Number(event.target.value));
                      }}
                      onPointerUp={() => setVolumePanelOpen(false)}
                      onKeyUp={() => setVolumePanelOpen(false)}
                      className="heart-sound-volume-slider h-2 w-full cursor-pointer appearance-none rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200"
                      style={
                        { "--volume": `${volumePercent}%` } as CSSProperties
                      }
                      aria-label="Adjust volume"
                    />
                    <Volume2 className="size-4 shrink-0 text-slate-500" />
                  </div>
                </div>
              ) : null}

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 shrink-0 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                onClick={() => setVolumePanelOpen((current) => !current)}
                aria-label={`Adjust volume, current ${volumePercent}%`}
                title={`Volume ${volumePercent}%`}
              >
                {volumeLevel > 0.6 ? (
                  <Volume2 className="size-3.5" />
                ) : (
                  <Volume1 className="size-3.5" />
                )}
              </Button>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 shrink-0 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              onClick={() => {
                const audio = audioRef.current;
                if (!audio) {
                  return;
                }
                audio.currentTime = 0;
                setCurrentTime(0);
              }}
              aria-label="Reset playback"
            >
              <RotateCcw className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
