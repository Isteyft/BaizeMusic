import type { Track, TrackListResponse } from '@baize/types'
import type { LyricLine } from '@baize/utils'
import { formatTime, parseLrc } from '@baize/utils'
import {
    Download,
    ListMusic,
    Pause,
    Play,
    Repeat,
    Repeat1,
    Search,
    Shuffle,
    SkipBack,
    SkipForward,
    Trash2,
    Volume2,
    VolumeX,
} from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const VOLUME_STORAGE_KEY = 'baize_player_volume'

interface TrackContextMenu {
    x: number
    y: number
    trackId: string
    index: number
}

type PlayMode = 'sequential' | 'random' | 'single'

function withApiBase(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url
    }
    return url
}

function readStoredVolume(): number {
    const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY)
    if (!raw) {
        return 1
    }
    const parsed = Number(raw)
    if (Number.isNaN(parsed)) {
        return 1
    }
    return Math.max(0, Math.min(1, parsed))
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

export default function App() {
    const audioRef = useRef<HTMLAudioElement>(null)
    const lyricListRef = useRef<HTMLDivElement>(null)
    const contextMenuRef = useRef<HTMLDivElement>(null)
    const playlistPopoverRef = useRef<HTMLDivElement>(null)
    const playlistToggleRef = useRef<HTMLButtonElement>(null)
    const [duration, setDuration] = useState(0)
    const [currentTime, setCurrentTime] = useState(0)
    const [volume, setVolume] = useState(1)
    const [isMuted, setIsMuted] = useState(false)
    const [isSeeking, setIsSeeking] = useState(false)
    const [tracks, setTracks] = useState<Track[]>([])
    const [currentIndex, setCurrentIndex] = useState(0)
    const [isPlaying, setIsPlaying] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [lyricLines, setLyricLines] = useState<LyricLine[]>([])
    const [lyricLoading, setLyricLoading] = useState(false)
    const [lyricError, setLyricError] = useState<string | null>(null)
    const [coverFailed, setCoverFailed] = useState(false)
    const [playlistTrackIds, setPlaylistTrackIds] = useState<string[]>([])
    const [isPlaylistOpen, setIsPlaylistOpen] = useState(false)
    const [contextMenu, setContextMenu] = useState<TrackContextMenu | null>(null)
    const [playMode, setPlayMode] = useState<PlayMode>('sequential')
    const [isSearchOpen, setIsSearchOpen] = useState(false)
    const [searchKeyword, setSearchKeyword] = useState('')

    const currentTrack = tracks[currentIndex]

    const trackMap = useMemo(() => new Map(tracks.map((track, index) => [track.id, { track, index }])), [tracks])
    const allTrackIds = useMemo(() => tracks.map(track => track.id), [tracks])
    const effectiveQueueIds = useMemo(() => (playlistTrackIds.length > 0 ? playlistTrackIds : allTrackIds), [playlistTrackIds, allTrackIds])
    const queueCursor = useMemo(() => {
        if (!currentTrack) {
            return -1
        }
        return effectiveQueueIds.indexOf(currentTrack.id)
    }, [effectiveQueueIds, currentTrack])
    const playlistTracks = useMemo(
        () => playlistTrackIds.map(trackId => trackMap.get(trackId)?.track).filter((track): track is Track => !!track),
        [playlistTrackIds, trackMap]
    )
    const normalizedKeyword = useMemo(() => searchKeyword.trim().toLowerCase(), [searchKeyword])
    const filteredTracks = useMemo(() => {
        if (!normalizedKeyword) {
            return tracks
        }
        return tracks.filter(track => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(normalizedKeyword))
    }, [tracks, normalizedKeyword])

    useEffect(() => {
        setVolume(readStoredVolume())
    }, [])

    useEffect(() => {
        let cancelled = false

        async function loadTracks() {
            setIsLoading(true)
            setError(null)
            try {
                const response = await fetch('/api/tracks')
                if (!response.ok) {
                    throw new Error(`request failed with status ${response.status}`)
                }
                const data = (await response.json()) as TrackListResponse
                if (cancelled) {
                    return
                }
                setTracks(data.tracks ?? [])
                setCurrentIndex(0)
            } catch (err: unknown) {
                if (cancelled) {
                    return
                }
                const message = err instanceof Error ? err.message : 'failed to load tracks'
                setError(message)
            } finally {
                if (!cancelled) {
                    setIsLoading(false)
                }
            }
        }

        void loadTracks()
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        setPlaylistTrackIds(prev => prev.filter(trackId => trackMap.has(trackId)))
    }, [trackMap])

    useEffect(() => {
        setCoverFailed(false)
    }, [currentTrack?.id])

    useEffect(() => {
        let cancelled = false

        async function loadLyric() {
            if (!currentTrack?.lyricUrl) {
                setLyricLines([])
                setLyricLoading(false)
                setLyricError(null)
                return
            }

            setLyricLoading(true)
            setLyricError(null)
            try {
                const response = await fetch(withApiBase(currentTrack.lyricUrl))
                if (!response.ok) {
                    throw new Error(`request failed with status ${response.status}`)
                }
                const text = await response.text()
                if (cancelled) {
                    return
                }
                setLyricLines(parseLrc(text))
            } catch (err: unknown) {
                if (cancelled) {
                    return
                }
                const message = err instanceof Error ? err.message : 'failed to load lyric'
                setLyricError(message)
                setLyricLines([])
            } finally {
                if (!cancelled) {
                    setLyricLoading(false)
                }
            }
        }

        void loadLyric()
        return () => {
            cancelled = true
        }
    }, [currentTrack])

    useEffect(() => {
        const audio = audioRef.current
        if (!audio || !currentTrack) {
            return
        }

        audio.src = withApiBase(currentTrack.streamUrl)
        setCurrentTime(0)
        setDuration(0)
        audio.load()
        if (isPlaying) {
            void audio.play().catch(() => {
                setIsPlaying(false)
            })
        }
    }, [currentTrack, isPlaying])

    useEffect(() => {
        const audio = audioRef.current
        if (!audio) {
            return
        }

        if (!isPlaying) {
            audio.pause()
            return
        }

        void audio.play().catch(() => {
            setIsPlaying(false)
        })
    }, [isPlaying])

    useEffect(() => {
        const audio = audioRef.current
        if (!audio) {
            return
        }
        audio.volume = volume
    }, [volume])

    useEffect(() => {
        const audio = audioRef.current
        if (!audio) {
            return
        }
        audio.muted = isMuted
    }, [isMuted])

    useEffect(() => {
        if (!contextMenu) {
            return
        }

        const close = () => setContextMenu(null)
        const closeWhenClickOutside = (event: MouseEvent) => {
            const target = event.target as Node | null
            if (contextMenuRef.current && target && contextMenuRef.current.contains(target)) {
                return
            }
            close()
        }
        const closeOnEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                close()
            }
        }

        window.addEventListener('mousedown', closeWhenClickOutside)
        window.addEventListener('scroll', close, true)
        window.addEventListener('keydown', closeOnEsc)
        return () => {
            window.removeEventListener('mousedown', closeWhenClickOutside)
            window.removeEventListener('scroll', close, true)
            window.removeEventListener('keydown', closeOnEsc)
        }
    }, [contextMenu])

    useEffect(() => {
        if (!isPlaylistOpen) {
            return
        }

        const closeWhenClickOutside = (event: MouseEvent) => {
            const target = event.target as Node | null
            const inPopover = !!(playlistPopoverRef.current && target && playlistPopoverRef.current.contains(target))
            const inToggle = !!(playlistToggleRef.current && target && playlistToggleRef.current.contains(target))
            if (inPopover || inToggle) {
                return
            }
            setIsPlaylistOpen(false)
        }

        const closeOnEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsPlaylistOpen(false)
            }
        }

        window.addEventListener('mousedown', closeWhenClickOutside)
        window.addEventListener('keydown', closeOnEsc)
        return () => {
            window.removeEventListener('mousedown', closeWhenClickOutside)
            window.removeEventListener('keydown', closeOnEsc)
        }
    }, [isPlaylistOpen])

    const canPlay = tracks.length > 0
    const canPrev = useMemo(() => canPlay && effectiveQueueIds.length > 0, [canPlay, effectiveQueueIds.length])
    const canNext = useMemo(() => canPlay && effectiveQueueIds.length > 0, [canPlay, effectiveQueueIds.length])

    const activeLyricIndex = useMemo(() => {
        if (lyricLines.length === 0) {
            return -1
        }
        for (let i = lyricLines.length - 1; i >= 0; i -= 1) {
            if (currentTime >= lyricLines[i].time) {
                return i
            }
        }
        return -1
    }, [currentTime, lyricLines])

    useEffect(() => {
        if (activeLyricIndex < 0) {
            return
        }
        const container = lyricListRef.current
        if (!container) {
            return
        }
        const activeNode = container.querySelector<HTMLParagraphElement>(`[data-lyric-index="${activeLyricIndex}"]`)
        if (!activeNode) {
            return
        }
        activeNode.scrollIntoView({
            block: 'center',
            behavior: 'smooth',
        })
    }, [activeLyricIndex])

    const playTrackByIndex = (index: number) => {
        setCurrentIndex(index)
        setIsPlaying(true)
    }

    const downloadTrack = (track: Track) => {
        window.open(withApiBase(`/api/tracks/${track.id}/download`), '_blank', 'noopener,noreferrer')
    }

    const addTrackToPlaylist = (track: Track) => {
        setPlaylistTrackIds(prev => (prev.includes(track.id) ? prev : [...prev, track.id]))
    }

    const playTrackFromPlaylist = (trackId: string) => {
        const item = trackMap.get(trackId)
        if (!item) {
            return
        }
        playTrackByIndex(item.index)
        setIsPlaylistOpen(false)
    }

    const removeTrackFromPlaylist = (trackId: string) => {
        setPlaylistTrackIds(prev => prev.filter(id => id !== trackId))
    }

    const onTrackContextMenu = (event: ReactMouseEvent, track: Track, index: number) => {
        event.preventDefault()
        const menuWidth = 210
        const menuHeight = 132
        const x = clamp(event.clientX, 8, window.innerWidth - menuWidth - 8)
        const y = clamp(event.clientY, 8, window.innerHeight - menuHeight - 8)
        setContextMenu({
            x,
            y,
            trackId: track.id,
            index,
        })
    }

    const onTogglePlay = () => {
        if (!canPlay) {
            return
        }
        setIsPlaying(prev => !prev)
    }

    const onPrev = () => {
        if (!canPrev) {
            return
        }
        const prevCursor =
            queueCursor < 0 ? effectiveQueueIds.length - 1 : (queueCursor - 1 + effectiveQueueIds.length) % effectiveQueueIds.length
        const prevTrackId = effectiveQueueIds[prevCursor]
        const prevTrack = prevTrackId ? trackMap.get(prevTrackId) : undefined
        if (!prevTrack) {
            return
        }
        playTrackByIndex(prevTrack.index)
    }

    const resolveNextTrackIndex = (): number | null => {
        if (!canPlay || effectiveQueueIds.length === 0) {
            return null
        }

        if (playMode === 'single') {
            return currentIndex
        }

        if (playMode === 'random') {
            const candidates = effectiveQueueIds
                .map(trackId => trackMap.get(trackId)?.index)
                .filter((index): index is number => typeof index === 'number')
            if (candidates.length === 0) {
                return null
            }
            if (candidates.length === 1) {
                return candidates[0]
            }
            const withoutCurrent = candidates.filter(index => index !== currentIndex)
            const pool = withoutCurrent.length > 0 ? withoutCurrent : candidates
            const randomIndex = Math.floor(Math.random() * pool.length)
            return pool[randomIndex] ?? null
        }

        const nextCursor = queueCursor < 0 ? 0 : (queueCursor + 1) % effectiveQueueIds.length
        const nextTrackId = effectiveQueueIds[nextCursor]
        const nextTrack = nextTrackId ? trackMap.get(nextTrackId) : undefined
        return nextTrack ? nextTrack.index : null
    }

    const onNext = () => {
        if (!canNext) {
            return
        }
        const nextIndex = resolveNextTrackIndex()
        if (nextIndex === null) {
            return
        }
        playTrackByIndex(nextIndex)
    }

    const onEnded = () => {
        if (!canNext) {
            setIsPlaying(false)
            return
        }
        const nextIndex = resolveNextTrackIndex()
        if (nextIndex === null) {
            setIsPlaying(false)
            return
        }
        playTrackByIndex(nextIndex)
    }

    const onTogglePlayMode = () => {
        setPlayMode(prev => {
            if (prev === 'sequential') {
                return 'random'
            }
            if (prev === 'random') {
                return 'single'
            }
            return 'sequential'
        })
    }

    const playModeLabel = useMemo(() => {
        if (playMode === 'random') {
            return '随机播放'
        }
        if (playMode === 'single') {
            return '单曲循环'
        }
        return '顺序播放'
    }, [playMode])
    const PlayModeIcon = playMode === 'random' ? Shuffle : playMode === 'single' ? Repeat1 : Repeat

    const onLoadedMetadata = () => {
        const audio = audioRef.current
        if (!audio) {
            return
        }
        setDuration(audio.duration || 0)
    }

    const onTimeUpdate = () => {
        if (isSeeking) {
            return
        }
        const audio = audioRef.current
        if (!audio) {
            return
        }
        setCurrentTime(audio.currentTime || 0)
    }

    const onSeekStart = () => {
        setIsSeeking(true)
    }

    const onSeekChange = (value: number) => {
        setCurrentTime(value)
    }

    const onSeekCommit = (value: number) => {
        const audio = audioRef.current
        if (!audio) {
            setIsSeeking(false)
            return
        }
        const nextTime = Math.max(0, Math.min(duration || 0, value))
        audio.currentTime = nextTime
        setCurrentTime(nextTime)
        setIsSeeking(false)
    }

    const onVolumeChange = (nextVolumePercent: number) => {
        const nextVolume = Math.max(0, Math.min(1, nextVolumePercent / 100))
        setVolume(nextVolume)
        window.localStorage.setItem(VOLUME_STORAGE_KEY, String(nextVolume))
        if (nextVolume > 0 && isMuted) {
            setIsMuted(false)
        }
    }

    const onToggleMute = () => {
        setIsMuted(prev => !prev)
    }

    const lyricBackgroundUrl = currentTrack?.coverUrl && !coverFailed ? `url("${withApiBase(currentTrack.coverUrl)}")` : undefined

    const contextTrack = contextMenu ? trackMap.get(contextMenu.trackId)?.track : undefined

    return (
        <main className="app-shell">
            <section className="app-content">
                <aside className="panel list-panel">
                    <div className="panel-title-row">
                        <h2>Playlist</h2>
                        <div className="panel-title-actions">
                            <button
                                type="button"
                                className="panel-search-btn"
                                onClick={() => setIsSearchOpen(prev => !prev)}
                                aria-label="Search tracks"
                                title="Search tracks"
                            >
                                <Search size={14} />
                            </button>
                        </div>
                    </div>
                    {isSearchOpen && (
                        <div className="track-search-wrap">
                            <input
                                type="text"
                                value={searchKeyword}
                                onChange={event => setSearchKeyword(event.target.value)}
                                placeholder="请输入标题"
                            />
                        </div>
                    )}
                    {isLoading && <p className="muted">Loading tracks...</p>}
                    {error && <p className="error">{error}</p>}
                    {!isLoading && !error && tracks.length === 0 && <p className="muted">No tracks found in ./music</p>}
                    <ul className="track-list">
                        {filteredTracks.map((track, index) => {
                            const sourceIndex = trackMap.get(track.id)?.index ?? index
                            return (
                                <li key={track.id}>
                                    <button
                                        type="button"
                                        onClick={() => playTrackByIndex(sourceIndex)}
                                        onContextMenu={event => onTrackContextMenu(event, track, sourceIndex)}
                                        className={sourceIndex === currentIndex ? 'track-item active' : 'track-item'}
                                    >
                                        <span className="track-title">{track.title}</span>
                                        <span className="track-meta">{track.artist}</span>
                                    </button>
                                </li>
                            )
                        })}
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
                                            className={index === activeLyricIndex ? 'lyric-line active' : 'lyric-line'}
                                        >
                                            {line.text}
                                        </p>
                                    ))}
                            </div>
                        </div>
                    </div>
                </section>
            </section>

            {contextMenu &&
                contextTrack &&
                createPortal(
                    <div
                        ref={contextMenuRef}
                        className="track-context-menu"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                        onMouseDown={event => event.stopPropagation()}
                        onClick={event => event.stopPropagation()}
                        onContextMenu={event => {
                            event.preventDefault()
                            event.stopPropagation()
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => {
                                playTrackByIndex(contextMenu.index)
                                setContextMenu(null)
                            }}
                        >
                            播放当前歌曲
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                addTrackToPlaylist(contextTrack)
                                setContextMenu(null)
                            }}
                        >
                            添加到播放列表
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                downloadTrack(contextTrack)
                                setContextMenu(null)
                            }}
                        >
                            下载歌曲
                        </button>
                    </div>,
                    document.body
                )}

            <footer className="player-dock">
                <div className="dock-track">
                    <div className={isPlaying ? 'vinyl spinning' : 'vinyl'}>
                        <div className="vinyl-center">
                            {currentTrack?.coverUrl && !coverFailed ? (
                                <img src={withApiBase(currentTrack.coverUrl)} alt={currentTrack.title} className="vinyl-cover" />
                            ) : (
                                <div className="vinyl-cover-placeholder" />
                            )}
                        </div>
                    </div>
                    <div className="dock-track-meta">
                        <p className="track-title-large">{currentTrack?.title ?? 'None'}</p>
                        <p className="track-meta">{currentTrack?.artist ?? '-'}</p>
                    </div>
                </div>

                <div className="dock-main">
                    <div className="controls icon-controls controls-above-progress">
                        <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="Previous">
                            <SkipBack size={16} />
                        </button>
                        <button type="button" onClick={onTogglePlay} disabled={!canPlay} aria-label="Play or pause">
                            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                        </button>
                        <button type="button" onClick={onNext} disabled={!canNext} aria-label="Next">
                            <SkipForward size={16} />
                        </button>
                        <button
                            type="button"
                            className="mode-btn icon-only"
                            onClick={onTogglePlayMode}
                            disabled={!canPlay}
                            aria-label="Play mode"
                            title={playModeLabel}
                        >
                            <PlayModeIcon size={15} />
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
                                onChange={event => onSeekChange(Number(event.target.value))}
                                onMouseUp={event => onSeekCommit(Number((event.target as HTMLInputElement).value))}
                                onTouchEnd={event => onSeekCommit(Number((event.target as HTMLInputElement).value))}
                                onKeyUp={event => onSeekCommit(Number((event.target as HTMLInputElement).value))}
                                disabled={!canPlay}
                            />
                            <span className="time-side">{formatTime(duration)}</span>
                        </div>
                    </div>
                </div>

                <div className="volume-wrap">
                    <button
                        type="button"
                        className="download-btn"
                        onClick={() => currentTrack && downloadTrack(currentTrack)}
                        disabled={!currentTrack}
                        aria-label="Download current track"
                        title="Download"
                    >
                        <Download size={16} />
                    </button>
                    <button
                        type="button"
                        className="playlist-btn"
                        onClick={() => setIsPlaylistOpen(prev => !prev)}
                        aria-label="Open playlist"
                        title="Playlist"
                        ref={playlistToggleRef}
                    >
                        <ListMusic size={16} />
                    </button>

                    {isPlaylistOpen && (
                        <div className="playlist-popover" ref={playlistPopoverRef}>
                            <p className="playlist-popover-title">{`当前播放列表（${playlistTracks.length} 首）`}</p>
                            {playlistTracks.length === 0 && <p className="playlist-empty">播放列表为空</p>}
                            <ul className="playlist-popover-list">
                                {playlistTracks.map(track => (
                                    <li key={track.id}>
                                        <button
                                            type="button"
                                            className="playlist-track-play"
                                            onClick={() => playTrackFromPlaylist(track.id)}
                                        >
                                            {track.title}
                                        </button>
                                        <button
                                            type="button"
                                            className="playlist-track-remove"
                                            onClick={() => removeTrackFromPlaylist(track.id)}
                                            aria-label={`Remove ${track.title}`}
                                            title="Remove from playlist"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="volume-control">
                        <button type="button" onClick={onToggleMute} disabled={!canPlay} aria-label="Mute">
                            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                        </button>
                        <div className="volume-popover">
                            <input
                                type="range"
                                min={0}
                                max={100}
                                step={1}
                                value={Math.round(volume * 100)}
                                onChange={event => onVolumeChange(Number(event.target.value))}
                                disabled={!canPlay}
                                aria-label="Volume"
                            />
                            <span>{Math.round(volume * 100)}%</span>
                        </div>
                    </div>
                </div>
            </footer>

            <audio ref={audioRef} onEnded={onEnded} onLoadedMetadata={onLoadedMetadata} onTimeUpdate={onTimeUpdate} preload="metadata" />
        </main>
    )
}
