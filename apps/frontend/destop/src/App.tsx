import type { Track } from '@baize/types'
import type { LyricLine } from '@baize/utils'
import { formatTime, parseLrc } from '@baize/utils'
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
    Copy,
    Download,
    FolderOpen,
    ListMusic,
    Minus,
    Pause,
    Play,
    RefreshCw,
    Repeat,
    Repeat1,
    Search,
    Shuffle,
    SkipBack,
    SkipForward,
    Square,
    Trash2,
    Volume2,
    VolumeX,
    X,
} from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const VOLUME_STORAGE_KEY = 'baize_player_volume'
const DESKTOP_MUSIC_DIRS_KEY = 'baize_desktop_music_dirs'

type PlayMode = 'sequential' | 'random' | 'single'

interface TrackContextMenu {
    x: number
    y: number
    trackId: string
    index: number
}

interface DesktopScannedTrack {
    id: string
    title: string
    artist: string
    album: string
    duration: number
    filePath: string
    coverPath?: string
    lyricPath?: string
}

type DownloadTaskStatus = 'pending' | 'downloading' | 'completed' | 'failed'

interface DownloadTask {
    taskId: string
    trackId: string
    title: string
    progress: number
    status: DownloadTaskStatus
    targetDir: string
    filePath?: string
    error?: string
}

interface DownloadProgressPayload {
    taskId: string
    progress: number
    status: DownloadTaskStatus
    filePath?: string
    error?: string
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

function readStoredMusicDirs(): string[] {
    const raw = window.localStorage.getItem(DESKTOP_MUSIC_DIRS_KEY)
    if (!raw) {
        return []
    }
    try {
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) {
            return []
        }
        return parsed
            .filter((item): item is string => typeof item === 'string')
            .map(item => item.trim())
            .filter(item => item.length > 0)
    } catch {
        return []
    }
}

function saveMusicDirs(dirs: string[]) {
    const normalized = dirs.map(dir => dir.trim()).filter(dir => dir.length > 0)
    window.localStorage.setItem(DESKTOP_MUSIC_DIRS_KEY, JSON.stringify(normalized))
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

export default function App() {
    const desktopMode = isTauri()
    const audioRef = useRef<HTMLAudioElement>(null)
    const lyricListRef = useRef<HTMLDivElement>(null)
    const contextMenuRef = useRef<HTMLDivElement>(null)
    const playlistPopoverRef = useRef<HTMLDivElement>(null)
    const playlistToggleRef = useRef<HTMLButtonElement>(null)
    const pathPanelRef = useRef<HTMLDivElement>(null)
    const pathPanelToggleRef = useRef<HTMLButtonElement>(null)
    const loadedTrackKeyRef = useRef<string | null>(null)

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
    const [isPathMenuOpen, setIsPathMenuOpen] = useState(false)
    const [musicDirs, setMusicDirs] = useState<string[]>(() => readStoredMusicDirs())
    const [musicDirInput, setMusicDirInput] = useState('')
    const [isWindowMaximized, setIsWindowMaximized] = useState(false)
    const [refreshNonce, setRefreshNonce] = useState(0)
    const [isDownloadPanelOpen, setIsDownloadPanelOpen] = useState(false)
    const [downloadTasks, setDownloadTasks] = useState<DownloadTask[]>([])
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
    const activeDownloadCount = useMemo(
        () => downloadTasks.filter(task => task.status === 'pending' || task.status === 'downloading').length,
        [downloadTasks]
    )

    useEffect(() => {
        setVolume(readStoredVolume())
    }, [])

    useEffect(() => {
        setPlaylistTrackIds(prev => prev.filter(trackId => trackMap.has(trackId)))
    }, [trackMap])

    useEffect(() => {
        let cancelled = false

        async function loadTracks() {
            setIsLoading(true)
            setError(null)
            try {
                let serverTracks: Track[] = []
                let serverError: string | null = null
                let localTracks: Track[] = []
                let localError: string | null = null

                try {
                    const response = await fetch('/api/tracks')
                    if (!response.ok) {
                        throw new Error(`请求失败，状态码: ${response.status}`)
                    }
                    const payload = (await response.json()) as { tracks: Track[] }
                    serverTracks = payload.tracks ?? []
                } catch (err: unknown) {
                    serverError = err instanceof Error ? err.message : '服务器歌曲加载失败'
                }

                if (desktopMode && musicDirs.length > 0) {
                    try {
                        const scanned = await invoke<DesktopScannedTrack[]>('scan_music_dirs', {
                            musicDirs,
                        })
                        localTracks = scanned.map(item => ({
                            id: item.id,
                            title: item.title,
                            artist: item.artist,
                            album: item.album,
                            duration: item.duration,
                            streamUrl: convertFileSrc(item.filePath),
                            coverUrl: item.coverPath ? convertFileSrc(item.coverPath) : undefined,
                            lyricUrl: item.lyricPath ? convertFileSrc(item.lyricPath) : undefined,
                        }))
                    } catch (err: unknown) {
                        localError = err instanceof Error ? err.message : '本地目录扫描失败'
                    }
                }

                const mergedTracks = [...serverTracks, ...localTracks]
                if (!cancelled) {
                    const currentTrackId = currentTrack?.id
                    const preservedIndex = currentTrackId ? mergedTracks.findIndex(track => track.id === currentTrackId) : -1
                    setTracks(mergedTracks)
                    setCurrentIndex(preservedIndex >= 0 ? preservedIndex : 0)
                    if (mergedTracks.length === 0) {
                        if (desktopMode) {
                            if (localError) {
                                setError(`本地目录扫描失败，请检查目录配置：${localError}`)
                            } else {
                                setError('未获取到歌曲，请添加音乐目录')
                            }
                        } else {
                            setError(serverError ?? localError)
                        }
                    } else if (serverError && localTracks.length > 0) {
                        setError(null)
                    } else if (localError && serverTracks.length > 0) {
                        setError('本地目录扫描失败，当前显示服务器歌曲')
                    } else {
                        setError(null)
                    }
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : '加载音乐失败'
                    setError(message)
                }
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
    }, [desktopMode, musicDirs, refreshNonce])

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
                const response = await fetch(currentTrack.lyricUrl)
                if (!response.ok) {
                    throw new Error(`歌词请求失败，状态码: ${response.status}`)
                }
                const text = await response.text()
                if (!cancelled) {
                    setLyricLines(parseLrc(text))
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : '加载歌词失败'
                    setLyricError(message)
                    setLyricLines([])
                }
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
        const nextTrackKey = `${currentTrack.id}::${currentTrack.streamUrl}`
        if (loadedTrackKeyRef.current === nextTrackKey) {
            return
        }
        loadedTrackKeyRef.current = nextTrackKey
        audio.src = currentTrack.streamUrl
        setCurrentTime(0)
        setDuration(0)
        audio.load()
        if (isPlaying) {
            void audio.play().catch(() => setIsPlaying(false))
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
        void audio.play().catch(() => setIsPlaying(false))
    }, [isPlaying])

    useEffect(() => {
        const audio = audioRef.current
        if (audio) {
            audio.volume = volume
        }
    }, [volume])

    useEffect(() => {
        const audio = audioRef.current
        if (audio) {
            audio.muted = isMuted
        }
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
            if (!inPopover && !inToggle) {
                setIsPlaylistOpen(false)
            }
        }
        window.addEventListener('mousedown', closeWhenClickOutside)
        return () => window.removeEventListener('mousedown', closeWhenClickOutside)
    }, [isPlaylistOpen])

    useEffect(() => {
        if (!isPathMenuOpen) {
            return
        }
        const closeWhenClickOutside = (event: MouseEvent) => {
            const target = event.target as Node | null
            const inPanel = !!(pathPanelRef.current && target && pathPanelRef.current.contains(target))
            const inToggle = !!(pathPanelToggleRef.current && target && pathPanelToggleRef.current.contains(target))
            if (!inPanel && !inToggle) {
                setIsPathMenuOpen(false)
            }
        }
        window.addEventListener('mousedown', closeWhenClickOutside)
        return () => window.removeEventListener('mousedown', closeWhenClickOutside)
    }, [isPathMenuOpen])

    useEffect(() => {
        if (!desktopMode) {
            return
        }

        const win = getCurrentWindow()
        let unlisten: (() => void) | undefined

        const syncMaximizedState = async () => {
            try {
                setIsWindowMaximized(await win.isMaximized())
            } catch {
                setIsWindowMaximized(false)
            }
        }

        void syncMaximizedState()
        void win
            .onResized(() => {
                void syncMaximizedState()
            })
            .then(fn => {
                unlisten = fn
            })

        return () => {
            if (unlisten) {
                unlisten()
            }
        }
    }, [desktopMode])

    const canPlay = tracks.length > 0
    const canPrev = canPlay && effectiveQueueIds.length > 0
    const canNext = canPlay && effectiveQueueIds.length > 0
    const hasDownloadTargetDir = musicDirs.length > 0

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
        if (activeNode) {
            activeNode.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
    }, [activeLyricIndex])

    const playTrackByIndex = (index: number) => {
        setCurrentIndex(index)
        setIsPlaying(true)
    }

    const isLocalTrack = (track?: Track): boolean => !!track && track.id.startsWith('local-')

    const downloadTrack = async (track: Track) => {
        if (isLocalTrack(track)) {
            return
        }

        const targetDir = musicDirs[0]?.trim()
        if (!targetDir) {
            setError('请先在“音乐目录”中添加至少一个本地目录')
            return
        }

        const downloadUrl = new URL(`/api/tracks/${encodeURIComponent(track.id)}/download`, window.location.origin).toString()
        const coverUrl = new URL(`/api/tracks/${encodeURIComponent(track.id)}/cover`, window.location.origin).toString()
        const taskId = `${track.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        setDownloadTasks(prev => [
            {
                taskId,
                trackId: track.id,
                title: track.title,
                progress: 0,
                status: 'pending',
                targetDir,
            },
            ...prev,
        ])
        setIsDownloadPanelOpen(true)

        try {
            setError(null)
            await invoke<string>('download_track_to_dir', {
                taskId,
                downloadUrl,
                targetDir,
                preferredFileName: `${track.artist} - ${track.title}`,
                coverUrl,
            })
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : '下载失败'
            setError(message)
            setDownloadTasks(prev => prev.map(task => (task.taskId === taskId ? { ...task, status: 'failed', error: message } : task)))
        }
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
            return pool[Math.floor(Math.random() * pool.length)] ?? null
        }

        const nextCursor = queueCursor < 0 ? 0 : (queueCursor + 1) % effectiveQueueIds.length
        const nextTrackId = effectiveQueueIds[nextCursor]
        const nextTrack = nextTrackId ? trackMap.get(nextTrackId) : undefined
        return nextTrack ? nextTrack.index : null
    }

    const onTrackContextMenu = (event: ReactMouseEvent, track: Track, index: number) => {
        event.preventDefault()
        const menuWidth = 210
        const menuHeight = 132
        setContextMenu({
            x: clamp(event.clientX, 8, window.innerWidth - menuWidth - 8),
            y: clamp(event.clientY, 8, window.innerHeight - menuHeight - 8),
            trackId: track.id,
            index,
        })
    }

    const onTogglePlay = () => {
        if (canPlay) {
            setIsPlaying(prev => !prev)
        }
    }

    const onPrev = () => {
        if (!canPrev) {
            return
        }
        const prevCursor =
            queueCursor < 0 ? effectiveQueueIds.length - 1 : (queueCursor - 1 + effectiveQueueIds.length) % effectiveQueueIds.length
        const prevTrackId = effectiveQueueIds[prevCursor]
        const prevTrack = prevTrackId ? trackMap.get(prevTrackId) : undefined
        if (prevTrack) {
            playTrackByIndex(prevTrack.index)
        }
    }

    const onNext = () => {
        if (!canNext) {
            return
        }
        const nextIndex = resolveNextTrackIndex()
        if (nextIndex !== null) {
            playTrackByIndex(nextIndex)
        }
    }

    useEffect(() => {
        if (!desktopMode) {
            return
        }

        let unlisten: (() => void) | undefined
        void listen<string>('tray-control', event => {
            const action = event.payload
            if (action === 'prev') {
                onPrev()
                return
            }
            if (action === 'next') {
                onNext()
                return
            }
            if (action === 'toggle-play') {
                onTogglePlay()
                return
            }
            if (action === 'open-music-dir') {
                setIsPathMenuOpen(true)
            }
        }).then(fn => {
            unlisten = fn
        })

        return () => {
            if (unlisten) {
                unlisten()
            }
        }
    }, [desktopMode, canPrev, canNext, canPlay, queueCursor, currentIndex, playMode, effectiveQueueIds, trackMap])

    useEffect(() => {
        if (!desktopMode) {
            return
        }

        let unlisten: (() => void) | undefined
        void listen<DownloadProgressPayload>('download-progress', event => {
            const payload = event.payload
            setDownloadTasks(prev => {
                const index = prev.findIndex(task => task.taskId === payload.taskId)
                if (index < 0) {
                    return prev
                }
                const next = [...prev]
                next[index] = {
                    ...next[index],
                    progress: Math.max(0, Math.min(100, payload.progress)),
                    status: payload.status,
                    filePath: payload.filePath ?? next[index].filePath,
                    error: payload.error ?? next[index].error,
                }
                return next
            })
        }).then(fn => {
            unlisten = fn
        })

        return () => {
            if (unlisten) {
                unlisten()
            }
        }
    }, [desktopMode])

    const onEnded = () => {
        const nextIndex = resolveNextTrackIndex()
        if (nextIndex === null) {
            setIsPlaying(false)
            return
        }
        playTrackByIndex(nextIndex)
    }

    const onTogglePlayMode = () => {
        setPlayMode(prev => (prev === 'sequential' ? 'random' : prev === 'random' ? 'single' : 'sequential'))
    }

    const playModeLabel = playMode === 'random' ? '随机播放' : playMode === 'single' ? '单曲循环' : '顺序播放'
    const PlayModeIcon = playMode === 'random' ? Shuffle : playMode === 'single' ? Repeat1 : Repeat

    const onLoadedMetadata = () => {
        const audio = audioRef.current
        if (audio) {
            setDuration(audio.duration || 0)
        }
    }

    const onTimeUpdate = () => {
        if (isSeeking) {
            return
        }
        const audio = audioRef.current
        if (audio) {
            setCurrentTime(audio.currentTime || 0)
        }
    }

    const onAudioError = () => {
        if (!currentTrack) {
            return
        }
        const target = isLocalTrack(currentTrack) ? '本地文件' : '网络文件'
        setError(`无法播放${target}：${currentTrack.title}`)
        setIsPlaying(false)
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

    const onAddMusicDir = () => {
        const nextDir = musicDirInput.trim()
        if (!nextDir) {
            return
        }
        setMusicDirs(prev => {
            if (prev.includes(nextDir)) {
                return prev
            }
            const next = [...prev, nextDir]
            saveMusicDirs(next)
            return next
        })
        setMusicDirInput('')
    }

    const onPickMusicDir = async () => {
        if (!desktopMode) {
            return
        }
        try {
            const selected = await invoke<string | null>('pick_music_dir')
            if (selected) {
                setMusicDirInput(selected)
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : '打开目录选择器失败')
        }
    }

    const onRemoveMusicDir = (dir: string) => {
        setMusicDirs(prev => {
            const next = prev.filter(item => item !== dir)
            saveMusicDirs(next)
            return next
        })
    }

    const onClearMusicDirs = () => {
        saveMusicDirs([])
        setMusicDirs([])
        setMusicDirInput('')
        setIsPathMenuOpen(false)
    }

    const onMinimize = async () => {
        if (!desktopMode) {
            return
        }
        try {
            await getCurrentWindow().minimize()
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : '最小化失败')
        }
    }

    const onToggleMaximize = async () => {
        if (!desktopMode) {
            return
        }
        try {
            const win = getCurrentWindow()
            await win.toggleMaximize()
            setIsWindowMaximized(await win.isMaximized())
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : '最大化失败')
        }
    }

    const onCloseWindow = async () => {
        if (!desktopMode) {
            return
        }
        try {
            await getCurrentWindow().close()
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : '关闭窗口失败')
        }
    }

    const onRefreshTracks = () => {
        setRefreshNonce(prev => prev + 1)
    }

    const lyricBackgroundUrl = currentTrack?.coverUrl && !coverFailed ? `url("${currentTrack.coverUrl}")` : undefined
    const contextTrack = contextMenu ? trackMap.get(contextMenu.trackId)?.track : undefined

    return (
        <main className="app-shell">
            <header className="titlebar" data-tauri-drag-region={desktopMode ? true : undefined}>
                <div className="titlebar-left" data-tauri-drag-region={desktopMode ? true : undefined}>
                    白泽音乐
                </div>
                <div className="titlebar-right" data-tauri-drag-region={false}>
                    <button
                        type="button"
                        className="titlebar-btn"
                        onClick={() => setIsPathMenuOpen(prev => !prev)}
                        ref={pathPanelToggleRef}
                        data-tauri-drag-region={false}
                        title="音乐目录"
                    >
                        <FolderOpen size={14} />
                        <span>音乐目录</span>
                    </button>
                    <button
                        type="button"
                        className="titlebar-btn icon-only"
                        onClick={onMinimize}
                        data-tauri-drag-region={false}
                        title="最小化"
                    >
                        <Minus size={14} />
                    </button>
                    <button
                        type="button"
                        className="titlebar-btn icon-only"
                        onClick={onToggleMaximize}
                        data-tauri-drag-region={false}
                        title={isWindowMaximized ? '还原' : '最大化'}
                    >
                        {isWindowMaximized ? <Copy size={13} /> : <Square size={13} />}
                    </button>
                    <button
                        type="button"
                        className="titlebar-btn close icon-only"
                        onClick={onCloseWindow}
                        data-tauri-drag-region={false}
                        title="关闭"
                    >
                        <X size={14} />
                    </button>
                </div>
            </header>

            {isPathMenuOpen && (
                <section className="path-panel" ref={pathPanelRef}>
                    <p className="path-panel-title">下载音乐目录管理</p>
                    <div className="path-panel-add">
                        <input
                            value={musicDirInput}
                            onChange={event => setMusicDirInput(event.target.value)}
                            placeholder="例如: E:\\Music\\Downloads"
                        />
                        <button type="button" onClick={onPickMusicDir}>
                            选择文件夹
                        </button>
                        <button type="button" onClick={onAddMusicDir}>
                            添加
                        </button>
                    </div>
                    <ul className="path-list">
                        {musicDirs.map(dir => (
                            <li key={dir}>
                                <span title={dir}>{dir}</span>
                                <button type="button" onClick={() => onRemoveMusicDir(dir)}>
                                    删除
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div className="path-panel-actions">
                        <button type="button" onClick={() => setIsPathMenuOpen(false)}>
                            关闭
                        </button>
                        <button type="button" onClick={onClearMusicDirs}>
                            清空
                        </button>
                    </div>
                </section>
            )}

            {isDownloadPanelOpen && (
                <section className="download-panel">
                    <div className="download-panel-header">
                        <p className="download-panel-title">下载列表</p>
                        <button type="button" onClick={() => setIsDownloadPanelOpen(false)}>
                            关闭
                        </button>
                    </div>
                    {downloadTasks.length === 0 && <p className="muted">暂无下载任务</p>}
                    {downloadTasks.length > 0 && (
                        <ul className="download-task-list">
                            {downloadTasks.map(task => (
                                <li key={task.taskId} className="download-task-item">
                                    <p className="download-task-title" title={task.title}>
                                        {task.title}
                                    </p>
                                    <p className="download-task-meta">
                                        {task.status === 'completed'
                                            ? '已完成'
                                            : task.status === 'failed'
                                              ? `失败${task.error ? `: ${task.error}` : ''}`
                                              : task.status === 'downloading'
                                                ? '下载中'
                                                : '等待中'}
                                        {task.status !== 'failed' && ` · ${Math.round(task.progress)}%`}
                                    </p>
                                    <div className="download-progress-track">
                                        <div className="download-progress-fill" style={{ width: `${task.progress}%` }} />
                                    </div>
                                    {task.filePath && (
                                        <p className="download-task-path" title={task.filePath}>
                                            {task.filePath}
                                        </p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}

            <section className="app-content">
                <aside className="panel list-panel">
                    <div className="panel-title-row">
                        <h2>歌曲列表</h2>
                        <div className="panel-title-actions">
                            <button
                                type="button"
                                className="panel-search-btn"
                                onClick={() => setIsSearchOpen(prev => !prev)}
                                aria-label="搜索歌曲"
                                title="搜索歌曲"
                            >
                                <Search size={14} />
                            </button>
                            <button
                                type="button"
                                className="panel-refresh-btn"
                                onClick={onRefreshTracks}
                                disabled={isLoading}
                                aria-label="刷新歌曲列表"
                                title="刷新"
                            >
                                <RefreshCw size={14} />
                            </button>
                            <button
                                type="button"
                                className="panel-download-list-btn"
                                onClick={() => setIsDownloadPanelOpen(true)}
                                aria-label="打开下载列表"
                                title="下载列表"
                            >
                                下载列表{activeDownloadCount > 0 ? ` (${activeDownloadCount})` : ''}
                            </button>
                        </div>
                    </div>
                    {isSearchOpen && (
                        <div className="track-search-wrap">
                            <input
                                type="text"
                                value={searchKeyword}
                                onChange={event => setSearchKeyword(event.target.value)}
                                placeholder="按歌名或歌手搜索"
                            />
                        </div>
                    )}
                    {desktopMode && musicDirs.length === 0 && <p className="muted">当前仅显示服务器歌曲，可在标题栏添加本地目录</p>}
                    {isLoading && <p className="muted">正在加载歌曲...</p>}
                    {error && <p className="error">{error}</p>}
                    {!isLoading && !error && tracks.length === 0 && <p className="muted">未扫描到歌曲文件</p>}
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
                    <h2>歌词</h2>
                    <div className="lyric-stage" style={{ backgroundImage: lyricBackgroundUrl }}>
                        {currentTrack?.coverUrl && (
                            <img
                                src={currentTrack.coverUrl}
                                alt=""
                                className="cover-probe"
                                onLoad={() => setCoverFailed(false)}
                                onError={() => setCoverFailed(true)}
                            />
                        )}
                        <div className="lyric-backdrop" />
                        <div className="lyric-box" ref={lyricListRef}>
                            <div className="lyric-content">
                                {lyricLoading && <p className="muted">正在加载歌词...</p>}
                                {lyricError && <p className="error">{lyricError}</p>}
                                {!lyricLoading && !lyricError && lyricLines.length === 0 && <p className="muted">暂无歌词</p>}
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
                        {!isLocalTrack(contextTrack) && hasDownloadTargetDir && (
                            <button
                                type="button"
                                onClick={() => {
                                    void downloadTrack(contextTrack)
                                    setContextMenu(null)
                                }}
                            >
                                下载歌曲
                            </button>
                        )}
                    </div>,
                    document.body
                )}

            <footer className="player-dock">
                <div className="dock-track">
                    <div className={isPlaying ? 'vinyl spinning' : 'vinyl'}>
                        <div className="vinyl-center">
                            {currentTrack?.coverUrl && !coverFailed ? (
                                <img src={currentTrack.coverUrl} alt={currentTrack.title} className="vinyl-cover" />
                            ) : (
                                <div className="vinyl-cover-placeholder" />
                            )}
                        </div>
                    </div>
                    <div className="dock-track-meta">
                        <p className="track-title-large">{currentTrack?.title ?? '未选择歌曲'}</p>
                        <p className="track-meta">{currentTrack?.artist ?? '-'}</p>
                    </div>
                </div>

                <div className="dock-main">
                    <div className="controls icon-controls controls-above-progress">
                        <button type="button" onClick={onPrev} disabled={!canPrev} aria-label="上一首">
                            <SkipBack size={16} />
                        </button>
                        <button type="button" onClick={onTogglePlay} disabled={!canPlay} aria-label="播放或暂停">
                            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                        </button>
                        <button type="button" onClick={onNext} disabled={!canNext} aria-label="下一首">
                            <SkipForward size={16} />
                        </button>
                        <button
                            type="button"
                            className="mode-btn icon-only"
                            onClick={onTogglePlayMode}
                            disabled={!canPlay}
                            aria-label="播放模式"
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
                                onMouseDown={() => setIsSeeking(true)}
                                onTouchStart={() => setIsSeeking(true)}
                                onChange={event => setCurrentTime(Number(event.target.value))}
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
                    {!isLocalTrack(currentTrack) && hasDownloadTargetDir && (
                        <button
                            type="button"
                            className="download-btn"
                            onClick={() => currentTrack && void downloadTrack(currentTrack)}
                            disabled={!currentTrack}
                            aria-label="下载当前歌曲"
                            title="下载"
                        >
                            <Download size={16} />
                        </button>
                    )}
                    <button
                        type="button"
                        className="playlist-btn"
                        onClick={() => setIsPlaylistOpen(prev => !prev)}
                        aria-label="打开播放列表"
                        title="播放列表"
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
                                            aria-label={`从播放列表删除 ${track.title}`}
                                            title="删除"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="volume-control">
                        <button type="button" onClick={() => setIsMuted(prev => !prev)} disabled={!canPlay} aria-label="静音">
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
                                aria-label="音量"
                            />
                            <span>{Math.round(volume * 100)}%</span>
                        </div>
                    </div>
                </div>
            </footer>

            <audio
                ref={audioRef}
                onEnded={onEnded}
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
                onError={onAudioError}
                preload="metadata"
            />
        </main>
    )
}
