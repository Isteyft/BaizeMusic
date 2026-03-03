import { useEffect, useMemo, useRef, useState } from "react";

import type { Track, TrackListResponse } from "@baize/types";
import { formatTime, parseLrc } from "@baize/utils";
import type { LyricLine } from "@baize/utils";

const VOLUME_STORAGE_KEY = "baize_player_volume";

function withApiBase(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return url;
}

function readStoredVolume(): number {
  const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
  if (!raw) {
    return 1;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    return 1;
  }
  return Math.max(0, Math.min(1, parsed));
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lyricListRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [lyricLoading, setLyricLoading] = useState(false);
  const [lyricError, setLyricError] = useState<string | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);

  const currentTrack = tracks[currentIndex];

  useEffect(() => {
    setVolume(readStoredVolume());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadTracks() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/tracks");
        if (!response.ok) {
          throw new Error(`request failed with status ${response.status}`);
        }
        const data = (await response.json()) as TrackListResponse;
        if (cancelled) {
          return;
        }
        setTracks(data.tracks ?? []);
        setCurrentIndex(0);
      } catch (err: unknown) {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : "failed to load tracks";
        setError(message);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadTracks();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCoverFailed(false);
  }, [currentTrack?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadLyric() {
      if (!currentTrack?.lyricUrl) {
        setLyricLines([]);
        setLyricLoading(false);
        setLyricError(null);
        return;
      }

      setLyricLoading(true);
      setLyricError(null);
      try {
        const response = await fetch(withApiBase(currentTrack.lyricUrl));
        if (!response.ok) {
          throw new Error(`request failed with status ${response.status}`);
        }
        const text = await response.text();
        if (cancelled) {
          return;
        }
        setLyricLines(parseLrc(text));
      } catch (err: unknown) {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : "failed to load lyric";
        setLyricError(message);
        setLyricLines([]);
      } finally {
        if (!cancelled) {
          setLyricLoading(false);
        }
      }
    }

    void loadLyric();
    return () => {
      cancelled = true;
    };
  }, [currentTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      return;
    }

    audio.src = withApiBase(currentTrack.streamUrl);
    setCurrentTime(0);
    setDuration(0);
    audio.load();
    if (isPlaying) {
      void audio.play().catch(() => {
        setIsPlaying(false);
      });
    }
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!isPlaying) {
      audio.pause();
      return;
    }

    void audio.play().catch(() => {
      setIsPlaying(false);
    });
  }, [isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.muted = isMuted;
  }, [isMuted]);

  const canPlay = tracks.length > 0;
  const canPrev = useMemo(() => canPlay && currentIndex > 0, [canPlay, currentIndex]);
  const canNext = useMemo(() => canPlay && currentIndex < tracks.length - 1, [canPlay, currentIndex, tracks.length]);

  const activeLyricIndex = useMemo(() => {
    if (lyricLines.length === 0) {
      return -1;
    }
    for (let i = lyricLines.length - 1; i >= 0; i -= 1) {
      if (currentTime >= lyricLines[i].time) {
        return i;
      }
    }
    return -1;
  }, [currentTime, lyricLines]);

  useEffect(() => {
    if (activeLyricIndex < 0) {
      return;
    }
    const container = lyricListRef.current;
    if (!container) {
      return;
    }
    const activeNode = container.querySelector<HTMLParagraphElement>(`[data-lyric-index="${activeLyricIndex}"]`);
    if (!activeNode) {
      return;
    }
    activeNode.scrollIntoView({
      block: "center",
      behavior: "smooth"
    });
  }, [activeLyricIndex]);

  const onSelectTrack = (index: number) => {
    setCurrentIndex(index);
    setIsPlaying(true);
  };

  const onTogglePlay = () => {
    if (!canPlay) {
      return;
    }
    setIsPlaying((prev) => !prev);
  };

  const onPrev = () => {
    if (!canPrev) {
      return;
    }
    setCurrentIndex((prev) => prev - 1);
    setIsPlaying(true);
  };

  const onNext = () => {
    if (!canNext) {
      return;
    }
    setCurrentIndex((prev) => prev + 1);
    setIsPlaying(true);
  };

  const onEnded = () => {
    if (currentIndex < tracks.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setIsPlaying(true);
      return;
    }
    setIsPlaying(false);
  };

  const onLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    setDuration(audio.duration || 0);
  };

  const onTimeUpdate = () => {
    if (isSeeking) {
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    setCurrentTime(audio.currentTime || 0);
  };

  const onSeekStart = () => {
    setIsSeeking(true);
  };

  const onSeekChange = (value: number) => {
    setCurrentTime(value);
  };

  const onSeekCommit = (value: number) => {
    const audio = audioRef.current;
    if (!audio) {
      setIsSeeking(false);
      return;
    }
    const nextTime = Math.max(0, Math.min(duration || 0, value));
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
    setIsSeeking(false);
  };

  const onVolumeChange = (nextVolumePercent: number) => {
    const nextVolume = Math.max(0, Math.min(1, nextVolumePercent / 100));
    setVolume(nextVolume);
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(nextVolume));
    if (nextVolume > 0 && isMuted) {
      setIsMuted(false);
    }
  };

  const onToggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  const lyricBackgroundUrl =
    currentTrack?.coverUrl && !coverFailed ? `url("${withApiBase(currentTrack.coverUrl)}")` : undefined;

  return (
    <main className="app-shell">
      <section className="app-content">
        <aside className="panel list-panel">
          <h2>Playlist</h2>
          {isLoading && <p className="muted">Loading tracks...</p>}
          {error && <p className="error">{error}</p>}
          {!isLoading && !error && tracks.length === 0 && <p className="muted">No tracks found in ./music</p>}
          <ul className="track-list">
            {tracks.map((track, index) => (
              <li key={track.id}>
                <button
                  type="button"
                  onClick={() => onSelectTrack(index)}
                  className={index === currentIndex ? "track-item active" : "track-item"}
                >
                  <span className="track-title">{track.title}</span>
                  <span className="track-meta">{track.artist}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="panel lyric-panel">
          <h2>Lyrics</h2>
          <div className="lyric-stage" style={{ backgroundImage: lyricBackgroundUrl }}>
            {currentTrack?.coverUrl && (
              <img
                src={withApiBase(currentTrack.coverUrl)}
                alt=""
                className="cover-probe"
                onLoad={() => setCoverFailed(false)}
                onError={() => setCoverFailed(true)}
              />
            )}
            <div className="lyric-backdrop" />
            <div className="lyric-box" ref={lyricListRef}>
              <div className="lyric-content">
                {lyricLoading && <p className="muted">Loading lyric...</p>}
                {lyricError && <p className="error">{lyricError}</p>}
                {!lyricLoading && !lyricError && lyricLines.length === 0 && <p className="muted">No lyric available</p>}
                {!lyricLoading &&
                  !lyricError &&
                  lyricLines.map((line, index) => (
                    <p
                      key={`${line.time}-${line.text}-${index}`}
                      data-lyric-index={index}
                      className={index === activeLyricIndex ? "lyric-line active" : "lyric-line"}
                    >
                      {line.text}
                    </p>
                  ))}
              </div>
            </div>
          </div>
        </section>
      </section>

      <footer className="player-dock">
        <div className="dock-track">
          <div className={isPlaying ? "vinyl spinning" : "vinyl"}>
            <div className="vinyl-center">
              {currentTrack?.coverUrl && !coverFailed ? (
                <img src={withApiBase(currentTrack.coverUrl)} alt={currentTrack.title} className="vinyl-cover" />
              ) : (
                <div className="vinyl-cover-placeholder" />
              )}
            </div>
          </div>
          <div className="dock-track-meta">
            <p className="track-title-large">{currentTrack?.title ?? "None"}</p>
            <p className="track-meta">{currentTrack?.artist ?? "-"}</p>
          </div>
        </div>

        <div className="dock-main">
          <div className="controls icon-controls controls-above-progress">
            <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="Previous">
              ⏮
            </button>
            <button type="button" onClick={onTogglePlay} disabled={!canPlay} aria-label="Play or pause">
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button type="button" onClick={onNext} disabled={!canNext} aria-label="Next">
              ⏭
            </button>
          </div>

          <div className="progress-wrap">
            <div className="progress-line">
              <span className="time-side">{formatTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(currentTime, duration || 0)}
                onMouseDown={onSeekStart}
                onTouchStart={onSeekStart}
                onChange={(event) => onSeekChange(Number(event.target.value))}
                onMouseUp={(event) => onSeekCommit(Number((event.target as HTMLInputElement).value))}
                onTouchEnd={(event) => onSeekCommit(Number((event.target as HTMLInputElement).value))}
                onKeyUp={(event) => onSeekCommit(Number((event.target as HTMLInputElement).value))}
                disabled={!canPlay}
              />
              <span className="time-side">{formatTime(duration)}</span>
            </div>
          </div>
        </div>

        <div className="volume-wrap">
          <button type="button" onClick={onToggleMute} disabled={!canPlay} aria-label="Mute">
            {isMuted ? "🔇" : "🔊"}
          </button>
          <div className="volume-popover">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume * 100)}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
              disabled={!canPlay}
              aria-label="Volume"
            />
            <span>{Math.round(volume * 100)}%</span>
          </div>
        </div>
      </footer>

      <audio
        ref={audioRef}
        onEnded={onEnded}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        preload="metadata"
      />
    </main>
  );
}
