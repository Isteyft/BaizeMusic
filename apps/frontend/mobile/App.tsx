import type { Track } from '@baize/types'
import { formatTime, type LyricLine, parseLrc } from '@baize/utils'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { Audio, type AVPlaybackStatusSuccess, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
    Animated,
    Easing,
    FlatList,
    type GestureResponderEvent,
    Image,
    type LayoutChangeEvent,
    Modal,
    Platform,
    Pressable,
    SafeAreaView,
    StatusBar as NativeStatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native'

type PlayMode = 'sequential' | 'random' | 'single'

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'])
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])
const SHARED_COVER_NAMES = new Set(['cover', 'folder', 'front', 'album', 'albumartsmall'])
const ID3_SCAN_BYTES = 512 * 1024
const SETTINGS_FILENAME = 'baize-mobile-settings.json'

type MobileSettings = {
    directoryUris: string[]
    networkTracks: NetworkTrackSetting[]
}

type NetworkTrackSetting = {
    url: string
    title?: string
    artist?: string
    lyricUrl?: string
}

function resolveApiBaseUrl() {
    const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.trim()
    if (fromEnv) {
        return fromEnv.replace(/\/+$/, '')
    }
    if (Platform.OS === 'android') {
        return 'http://10.0.2.2:3000'
    }
    return 'http://localhost:3000'
}

function normalizeTrackUrl(url: string, apiBaseUrl: string) {
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url
    }
    if (url.startsWith('/')) {
        return `${apiBaseUrl}${url}`
    }
    return `${apiBaseUrl}/${url}`
}

function getFileBaseName(input: string) {
    const clean = decodeURIComponent(input).split('?')[0] ?? input
    const name = clean.split('/').pop() ?? clean
    return name.replace(/\.[^.]+$/, '')
}

function getFileName(input: string) {
    const clean = decodeURIComponent(input).split('?')[0] ?? input
    return clean.split('/').pop() ?? clean
}

function getFileExtension(input: string) {
    const clean = decodeURIComponent(input).split('?')[0] ?? input
    const name = clean.split('/').pop() ?? ''
    const ext = name.includes('.') ? (name.split('.').pop() ?? '') : ''
    return ext.toLowerCase()
}

function createLocalTrack(uri: string, displayName?: string, coverUrl?: string): Track {
    const title = displayName ? displayName.replace(/\.[^.]+$/, '') : getFileBaseName(uri)
    return {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        artist: '本地文件',
        album: '本地导入',
        duration: 0,
        streamUrl: uri,
        coverUrl,
    }
}

function resolveDirectoryCoverMap(uris: string[]) {
    const exactStemCover = new Map<string, string>()
    const coverSuffixStem = new Map<string, string>()
    let sharedCover: string | undefined

    for (const uri of uris) {
        const ext = getFileExtension(uri)
        if (!IMAGE_EXTENSIONS.has(ext)) continue
        const stem = getFileBaseName(uri).toLowerCase()
        if (!stem) continue

        if (!sharedCover && SHARED_COVER_NAMES.has(stem)) {
            sharedCover = uri
        }
        if (stem.endsWith('.cover')) {
            const trackStem = stem.slice(0, -'.cover'.length)
            if (trackStem && !coverSuffixStem.has(trackStem)) {
                coverSuffixStem.set(trackStem, uri)
            }
        }
        if (!exactStemCover.has(stem)) {
            exactStemCover.set(stem, uri)
        }
    }

    return { exactStemCover, coverSuffixStem, sharedCover }
}

function base64ToBytes(base64: string): Uint8Array | null {
    if (typeof atob !== 'function') return null
    try {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i)
        }
        return bytes
    } catch {
        return null
    }
}

function bytesToBase64(bytes: Uint8Array): string | null {
    if (typeof btoa !== 'function') return null
    try {
        let binary = ''
        const chunkSize = 0x8000
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize)
            binary += String.fromCharCode(...chunk)
        }
        return btoa(binary)
    } catch {
        return null
    }
}

function readSynchsafeInt(bytes: Uint8Array, start: number) {
    return (
        (((bytes[start] ?? 0) & 0x7f) << 21) |
        (((bytes[start + 1] ?? 0) & 0x7f) << 14) |
        (((bytes[start + 2] ?? 0) & 0x7f) << 7) |
        ((bytes[start + 3] ?? 0) & 0x7f)
    )
}

function readUInt32BE(bytes: Uint8Array, start: number) {
    return ((bytes[start] ?? 0) << 24) | ((bytes[start + 1] ?? 0) << 16) | ((bytes[start + 2] ?? 0) << 8) | (bytes[start + 3] ?? 0)
}

function extractId3CoverDataUri(bytes: Uint8Array): string | undefined {
    if (bytes.length < 10) return undefined
    if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return undefined

    const major = bytes[3] ?? 0
    if (major < 2 || major > 4) return undefined

    const flags = bytes[5] ?? 0
    const tagSize = readSynchsafeInt(bytes, 6)
    const tagEnd = Math.min(bytes.length, 10 + tagSize)
    let offset = 10

    if ((flags & 0x40) !== 0 && offset + 4 <= tagEnd) {
        if (major === 4) {
            const extSize = readSynchsafeInt(bytes, offset)
            offset += extSize
        } else {
            const extSize = readUInt32BE(bytes, offset)
            offset += 4 + Math.max(0, extSize)
        }
    }

    while (offset + 10 <= tagEnd) {
        const frameId = String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0)
        if (!/^[A-Z0-9]{4}$/.test(frameId)) break

        const frameSize = major === 4 ? readSynchsafeInt(bytes, offset + 4) : readUInt32BE(bytes, offset + 4)
        if (frameSize <= 0) break

        const frameStart = offset + 10
        const frameEnd = Math.min(tagEnd, frameStart + frameSize)
        if (frameEnd <= frameStart) break

        if (frameId === 'APIC') {
            let pos = frameStart
            const encoding = bytes[pos] ?? 0
            pos += 1

            const mimeEnd = bytes.indexOf(0, pos)
            if (mimeEnd < 0 || mimeEnd >= frameEnd) return undefined
            const mimeRaw = String.fromCharCode(...bytes.slice(pos, mimeEnd))
                .trim()
                .toLowerCase()
            const mimeType = mimeRaw.startsWith('image/') ? mimeRaw : 'image/jpeg'
            pos = mimeEnd + 1

            pos += 1 // picture type

            if (encoding === 1 || encoding === 2) {
                while (pos + 1 < frameEnd && !(bytes[pos] === 0 && bytes[pos + 1] === 0)) pos += 1
                pos = Math.min(frameEnd, pos + 2)
            } else {
                while (pos < frameEnd && bytes[pos] !== 0) pos += 1
                pos = Math.min(frameEnd, pos + 1)
            }

            if (pos >= frameEnd) return undefined
            const imageBase64 = bytesToBase64(bytes.slice(pos, frameEnd))
            if (!imageBase64) return undefined
            return `data:${mimeType};base64,${imageBase64}`
        }

        offset = frameEnd
    }

    return undefined
}

async function extractEmbeddedCoverDataUriFromAudioUri(uri: string): Promise<string | undefined> {
    const readCoverFromUri = async (targetUri: string) => {
        const base64 = await FileSystem.readAsStringAsync(targetUri, {
            encoding: FileSystem.EncodingType.Base64,
            position: 0,
            length: ID3_SCAN_BYTES,
        })
        if (!base64) return undefined
        const bytes = base64ToBytes(base64)
        if (!bytes) return undefined
        return extractId3CoverDataUri(bytes)
    }

    try {
        return await readCoverFromUri(uri)
    } catch {
        // SAF/content URI may fail on ranged read; copy to cache and retry.
        try {
            const cacheRoot = FileSystem.cacheDirectory
            if (!cacheRoot) return undefined
            const ext = getFileExtension(uri) || 'audio'
            const localUri = `${cacheRoot}cover-scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
            await FileSystem.copyAsync({ from: uri, to: localUri })
            try {
                return await readCoverFromUri(localUri)
            } finally {
                await FileSystem.deleteAsync(localUri, { idempotent: true })
            }
        } catch {
            return undefined
        }
    }
}

function toUserFriendlyError(error: unknown, fallback: string) {
    if (!(error instanceof Error)) {
        return fallback
    }
    const message = error.message.toLowerCase()
    const isNetworkError =
        message.includes('network request failed') ||
        message.includes('network error') ||
        message.includes('failed to fetch') ||
        message.includes('fetch failed') ||
        message.includes('econnrefused') ||
        message.includes('enotfound') ||
        message.includes('timeout') ||
        message.includes('timed out')
    return isNetworkError ? fallback : error.message
}

function getSettingsFileUri() {
    const docDir = FileSystem.documentDirectory
    if (!docDir) return null
    return `${docDir}${SETTINGS_FILENAME}`
}

function normalizeDirectoryUris(input: unknown): string[] {
    if (!Array.isArray(input)) return []
    const unique = new Set<string>()
    for (const item of input) {
        if (typeof item !== 'string') continue
        const normalized = item.trim()
        if (!normalized) continue
        unique.add(normalized)
    }
    return Array.from(unique)
}

function normalizeNetworkTrackUrls(input: unknown): string[] {
    if (!Array.isArray(input)) return []
    const unique = new Set<string>()
    for (const item of input) {
        if (typeof item !== 'string') continue
        const normalized = item.trim()
        if (!normalized) continue
        if (!/^https?:\/\//i.test(normalized)) continue
        unique.add(normalized)
    }
    return Array.from(unique)
}

function normalizeNetworkTrackSettings(input: unknown): NetworkTrackSetting[] {
    if (!Array.isArray(input)) return []
    const unique = new Set<string>()
    const normalizedItems: NetworkTrackSetting[] = []
    for (const item of input) {
        let url = ''
        let title: string | undefined
        let artist: string | undefined
        let lyricUrl: string | undefined

        if (typeof item === 'string') {
            url = item.trim()
        } else if (item && typeof item === 'object') {
            const maybe = item as { url?: unknown; title?: unknown; artist?: unknown; lyricUrl?: unknown }
            url = typeof maybe.url === 'string' ? maybe.url.trim() : ''
            title = typeof maybe.title === 'string' ? maybe.title.trim() || undefined : undefined
            artist = typeof maybe.artist === 'string' ? maybe.artist.trim() || undefined : undefined
            const rawLyricUrl = typeof maybe.lyricUrl === 'string' ? maybe.lyricUrl.trim() : ''
            lyricUrl = rawLyricUrl && /^https?:\/\//i.test(rawLyricUrl) ? rawLyricUrl : undefined
        }

        if (!url || !/^https?:\/\//i.test(url) || unique.has(url)) continue
        unique.add(url)
        normalizedItems.push({ url, title, artist, lyricUrl })
    }
    return normalizedItems
}

function createNetworkTrack(input: NetworkTrackSetting): Track {
    const title = input.title?.trim() || getFileBaseName(input.url) || '网络音乐'
    const artist = input.artist?.trim() || '网络音乐'
    return {
        id: `network-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        artist,
        album: '网络导入',
        duration: 0,
        streamUrl: input.url,
        lyricUrl: input.lyricUrl,
    }
}

function isUserImportedTrack(track: Track) {
    return track.id.startsWith('local-') || track.id.startsWith('network-')
}

async function loadMobileSettings(): Promise<MobileSettings> {
    const uri = getSettingsFileUri()
    if (!uri) return { directoryUris: [], networkTracks: [] }
    try {
        const info = await FileSystem.getInfoAsync(uri)
        if (!info.exists) return { directoryUris: [], networkTracks: [] }
        const raw = await FileSystem.readAsStringAsync(uri)
        const parsed = JSON.parse(raw) as { directoryUris?: unknown; networkTracks?: unknown; networkTrackUrls?: unknown }
        const networkTracks = normalizeNetworkTrackSettings(parsed.networkTracks)
        if (networkTracks.length === 0) {
            const legacy = normalizeNetworkTrackUrls(parsed.networkTrackUrls).map(url => ({ url }))
            return {
                directoryUris: normalizeDirectoryUris(parsed.directoryUris),
                networkTracks: legacy,
            }
        }
        return {
            directoryUris: normalizeDirectoryUris(parsed.directoryUris),
            networkTracks,
        }
    } catch {
        return { directoryUris: [], networkTracks: [] }
    }
}

async function saveMobileSettings(settings: MobileSettings) {
    const uri = getSettingsFileUri()
    if (!uri) return
    const payload = JSON.stringify(
        {
            directoryUris: normalizeDirectoryUris(settings.directoryUris),
            networkTracks: normalizeNetworkTrackSettings(settings.networkTracks),
        },
        null,
        2
    )
    await FileSystem.writeAsStringAsync(uri, payload, { encoding: FileSystem.EncodingType.UTF8 })
}

export default function App() {
    const soundRef = useRef<Audio.Sound | null>(null)
    const currentIndexRef = useRef(-1)
    const playModeRef = useRef<PlayMode>('sequential')
    const effectiveQueueIdsRef = useRef<string[]>([])
    const trackMapRef = useRef<Map<string, { track: Track; index: number }>>(new Map())
    const menuAnim = useRef(new Animated.Value(0)).current
    const recordSpinAnim = useRef(new Animated.Value(0)).current
    const recordSpinLoopRef = useRef<Animated.CompositeAnimation | null>(null)
    const apiBaseUrl = useMemo(() => resolveApiBaseUrl(), [])

    const [tracks, setTracks] = useState<Track[]>([])
    const [playlistTrackIds, setPlaylistTrackIds] = useState<string[]>([])
    const [currentIndex, setCurrentIndex] = useState<number>(-1)
    const [, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [playMode, setPlayMode] = useState<PlayMode>('sequential')
    const [isPlaying, setIsPlaying] = useState(false)
    const [positionMs, setPositionMs] = useState(0)
    const [durationMs, setDurationMs] = useState(0)
    const [lyricLines, setLyricLines] = useState<LyricLine[]>([])
    const [lyricLoading, setLyricLoading] = useState(false)
    const [menuVisible, setMenuVisible] = useState(false)
    const [playlistVisible, setPlaylistVisible] = useState(false)
    const [progressWidth, setProgressWidth] = useState(0)
    const [isSeeking, setIsSeeking] = useState(false)
    const [seekPreviewMs, setSeekPreviewMs] = useState(0)
    const [directoryUris, setDirectoryUris] = useState<string[]>([])
    const [networkTracks, setNetworkTracks] = useState<NetworkTrackSetting[]>([])
    const [settingsHydrated, setSettingsHydrated] = useState(false)
    const [addMenuVisible, setAddMenuVisible] = useState(false)
    const [networkFormVisible, setNetworkFormVisible] = useState(false)
    const [networkFormUrl, setNetworkFormUrl] = useState('')
    const [networkFormTitle, setNetworkFormTitle] = useState('')
    const [networkFormArtist, setNetworkFormArtist] = useState('')
    const [networkFormLyricUrl, setNetworkFormLyricUrl] = useState('')
    const [songSearchKeyword, setSongSearchKeyword] = useState('')
    const androidTopOffset = Platform.OS === 'android' ? (NativeStatusBar.currentHeight ?? 0) : 0

    const currentTrack = currentIndex >= 0 ? tracks[currentIndex] : undefined
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
    const filteredTracks = useMemo(() => {
        const keyword = songSearchKeyword.trim().toLowerCase()
        if (!keyword) return tracks
        return tracks.filter(track => {
            const title = track.title.toLowerCase()
            const artist = track.artist.toLowerCase()
            const album = track.album.toLowerCase()
            return title.includes(keyword) || artist.includes(keyword) || album.includes(keyword)
        })
    }, [songSearchKeyword, tracks])
    const activeLyricIndex = useMemo(() => {
        if (lyricLines.length === 0) {
            return -1
        }
        const currentSec = positionMs / 1000
        for (let i = lyricLines.length - 1; i >= 0; i -= 1) {
            const line = lyricLines[i]
            if (line && currentSec >= line.time) {
                return i
            }
        }
        return -1
    }, [positionMs, lyricLines])

    const uiPositionMs = isSeeking ? seekPreviewMs : positionMs
    const progressRatio = durationMs > 0 ? Math.min(1, uiPositionMs / durationMs) : 0

    const lyricPreview = useMemo(() => {
        if (lyricLoading) {
            return ['歌词加载中...', '', '']
        }
        if (lyricLines.length === 0) {
            return ['暂无歌词', '', '']
        }
        if (activeLyricIndex < 0) {
            const initial = lyricLines.slice(0, 3).map(line => line.text || '...')
            while (initial.length < 3) initial.push('')
            return initial
        }
        const start = Math.max(0, activeLyricIndex - 1)
        const preview = lyricLines.slice(start, start + 3).map(line => line.text || '...')
        while (preview.length < 3) preview.push('')
        return preview
    }, [activeLyricIndex, lyricLines, lyricLoading])

    useEffect(() => {
        currentIndexRef.current = currentIndex
    }, [currentIndex])

    useEffect(() => {
        playModeRef.current = playMode
    }, [playMode])

    useEffect(() => {
        effectiveQueueIdsRef.current = effectiveQueueIds
    }, [effectiveQueueIds])

    useEffect(() => {
        trackMapRef.current = trackMap
    }, [trackMap])

    useEffect(() => {
        void Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            interruptionModeIOS: InterruptionModeIOS.DoNotMix,
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
            interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
            shouldDuckAndroid: true,
            playThroughEarpieceAndroid: false,
        }).catch(() => {
            setError(prev => prev ?? '音频会话初始化失败，后台播放可能不可用')
        })
    }, [])

    useEffect(() => {
        setPlaylistTrackIds(prev => prev.filter(trackId => trackMap.has(trackId)))
    }, [trackMap])

    useEffect(() => {
        let cancelled = false

        const loadTracks = async () => {
            setIsLoading(true)
            setError(null)
            try {
                const response = await fetch(`${apiBaseUrl}/api/tracks`)
                if (!response.ok) {
                    throw new Error(`请求失败: ${response.status}`)
                }
                const payload = (await response.json()) as { tracks?: Track[] }
                const normalized = (payload.tracks ?? []).map(track => ({
                    ...track,
                    streamUrl: normalizeTrackUrl(track.streamUrl, apiBaseUrl),
                    coverUrl: track.coverUrl ? normalizeTrackUrl(track.coverUrl, apiBaseUrl) : undefined,
                    lyricUrl: track.lyricUrl ? normalizeTrackUrl(track.lyricUrl, apiBaseUrl) : undefined,
                }))
                if (!cancelled) {
                    setTracks(prev => {
                        const localTracks = prev.filter(item => isUserImportedTrack(item))
                        return [...normalized, ...localTracks]
                    })
                    setCurrentIndex(prev => (prev >= 0 ? prev : normalized.length > 0 ? 0 : -1))
                }
            } catch {
                if (!cancelled) {
                    setError(null)
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
    }, [apiBaseUrl])

    useEffect(() => {
        return () => {
            if (recordSpinLoopRef.current) {
                recordSpinLoopRef.current.stop()
            }
            if (soundRef.current) {
                void soundRef.current.unloadAsync()
            }
        }
    }, [])

    useEffect(() => {
        if (isPlaying) {
            if (!recordSpinLoopRef.current) {
                recordSpinLoopRef.current = Animated.loop(
                    Animated.timing(recordSpinAnim, {
                        toValue: 1,
                        duration: 36000,
                        easing: Easing.linear,
                        useNativeDriver: true,
                    })
                )
            }
            recordSpinLoopRef.current.start()
            return
        }
        if (recordSpinLoopRef.current) {
            recordSpinLoopRef.current.stop()
            recordSpinLoopRef.current = null
        }
        recordSpinAnim.stopAnimation(value => {
            recordSpinAnim.setValue(value % 1)
        })
    }, [isPlaying, recordSpinAnim])

    useEffect(() => {
        let cancelled = false

        const loadLyric = async () => {
            if (!currentTrack?.lyricUrl) {
                setLyricLines([])
                setLyricLoading(false)
                return
            }

            setLyricLoading(true)
            try {
                const response = await fetch(currentTrack.lyricUrl)
                if (!response.ok) {
                    throw new Error(`歌词请求失败: ${response.status}`)
                }
                const text = await response.text()
                if (!cancelled) {
                    setLyricLines(parseLrc(text))
                }
            } catch {
                if (!cancelled) {
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
    }, [currentTrack?.lyricUrl])

    const getRandomIndexFromQueue = (
        queueIds: string[],
        current: number,
        map: Map<string, { track: Track; index: number }>
    ): number | null => {
        const candidates = queueIds.map(trackId => map.get(trackId)?.index).filter((index): index is number => typeof index === 'number')
        if (candidates.length === 0) return null
        if (candidates.length === 1) return candidates[0] ?? null
        const withoutCurrent = candidates.filter(index => index !== current)
        const pool = withoutCurrent.length > 0 ? withoutCurrent : candidates
        const picked = pool[Math.floor(Math.random() * pool.length)]
        return typeof picked === 'number' ? picked : null
    }

    const resolveNextTrackIndex = (
        current: number,
        mode: PlayMode,
        queueIds: string[],
        map: Map<string, { track: Track; index: number }>
    ): number | null => {
        if (tracks.length === 0 || queueIds.length === 0) return null
        if (mode === 'single') return current
        if (mode === 'random') return getRandomIndexFromQueue(queueIds, current, map)
        const currentTrackId = tracks[current]?.id
        const cursor = currentTrackId ? queueIds.indexOf(currentTrackId) : -1
        const nextCursor = cursor < 0 ? 0 : (cursor + 1) % queueIds.length
        const nextTrackId = queueIds[nextCursor]
        const nextTrack = nextTrackId ? map.get(nextTrackId) : undefined
        return nextTrack ? nextTrack.index : null
    }

    const resolvePrevTrackIndex = (
        current: number,
        mode: PlayMode,
        queueIds: string[],
        map: Map<string, { track: Track; index: number }>
    ): number | null => {
        if (tracks.length === 0 || queueIds.length === 0) return null
        if (mode === 'single') return current
        if (mode === 'random') return getRandomIndexFromQueue(queueIds, current, map)
        const currentTrackId = tracks[current]?.id
        const cursor = currentTrackId ? queueIds.indexOf(currentTrackId) : -1
        const prevCursor = cursor < 0 ? queueIds.length - 1 : (cursor - 1 + queueIds.length) % queueIds.length
        const prevTrackId = queueIds[prevCursor]
        const prevTrack = prevTrackId ? map.get(prevTrackId) : undefined
        return prevTrack ? prevTrack.index : null
    }

    const playTrack = async (index: number) => {
        const track = tracks[index]
        if (!track) return

        setCurrentIndex(index)
        setPositionMs(0)
        setDurationMs(0)
        setIsSeeking(false)
        setSeekPreviewMs(0)
        setError(null)
        try {
            if (soundRef.current) {
                await soundRef.current.unloadAsync()
                soundRef.current = null
            }

            const { sound } = await Audio.Sound.createAsync({ uri: track.streamUrl }, { shouldPlay: true }, status => {
                if (!status.isLoaded) return
                const loaded = status as AVPlaybackStatusSuccess
                setIsPlaying(loaded.isPlaying)
                if (!isSeeking) {
                    setPositionMs(loaded.positionMillis)
                }
                setDurationMs(loaded.durationMillis ?? 0)
                if (loaded.didJustFinish) {
                    const next = resolveNextTrackIndex(
                        currentIndexRef.current,
                        playModeRef.current,
                        effectiveQueueIdsRef.current,
                        trackMapRef.current
                    )
                    if (next !== null) {
                        void playTrack(next)
                    } else {
                        setIsPlaying(false)
                    }
                }
            })

            soundRef.current = sound
            setIsPlaying(true)
        } catch (err: unknown) {
            setError(toUserFriendlyError(err, '播放失败，请稍后重试'))
            setIsPlaying(false)
        }
    }

    const togglePlayPause = async () => {
        if (!soundRef.current) {
            if (currentIndex >= 0) await playTrack(currentIndex)
            return
        }
        const status = await soundRef.current.getStatusAsync()
        if (!status.isLoaded) return
        if (status.isPlaying) {
            await soundRef.current.pauseAsync()
        } else {
            await soundRef.current.playAsync()
        }
    }

    const playPrev = async () => {
        if (tracks.length === 0 || currentIndex < 0) return
        const target = resolvePrevTrackIndex(currentIndex, playMode, effectiveQueueIds, trackMap)
        if (target !== null) await playTrack(target)
    }

    const playNext = async () => {
        if (tracks.length === 0 || currentIndex < 0) return
        const target = resolveNextTrackIndex(currentIndex, playMode, effectiveQueueIds, trackMap)
        if (target !== null) await playTrack(target)
    }

    const togglePlayMode = () => {
        setPlayMode(prev => {
            if (prev === 'sequential') return 'random'
            if (prev === 'random') return 'single'
            return 'sequential'
        })
    }

    const addTrackToPlaylist = (track: Track) => {
        setPlaylistTrackIds(prev => (prev.includes(track.id) ? prev : [...prev, track.id]))
    }

    const removeTrackFromPlaylist = (trackId: string) => {
        setPlaylistTrackIds(prev => prev.filter(id => id !== trackId))
    }

    const clearPlaylist = () => {
        setPlaylistTrackIds([])
    }

    const removeTrackFromLibrary = async (trackId: string) => {
        const removingIndex = tracks.findIndex(track => track.id === trackId)
        if (removingIndex < 0) return
        const removingTrack = tracks[removingIndex]

        const removingCurrent = currentIndex === removingIndex
        const nextLength = tracks.length - 1

        setTracks(prev => prev.filter(track => track.id !== trackId))
        setPlaylistTrackIds(prev => prev.filter(id => id !== trackId))
        if (removingTrack?.id.startsWith('network-')) {
            setNetworkTracks(prev => prev.filter(item => item.url !== removingTrack.streamUrl))
        }
        setCurrentIndex(prev => {
            if (prev < 0) return -1
            if (prev === removingIndex) {
                if (nextLength <= 0) return -1
                return Math.min(removingIndex, nextLength - 1)
            }
            if (prev > removingIndex) return prev - 1
            return prev
        })

        if (removingCurrent && soundRef.current) {
            await soundRef.current.unloadAsync()
            soundRef.current = null
            setIsPlaying(false)
            setPositionMs(0)
            setDurationMs(0)
            setIsSeeking(false)
            setSeekPreviewMs(0)
            setLyricLines([])
        }
        setError(null)
    }

    const appendLocalTracks = (incoming: Track[], options?: { suppressNoopError?: boolean }) => {
        if (incoming.length === 0) {
            if (!options?.suppressNoopError) {
                setError('No audio files found to add')
            }
            return
        }
        let addedCount = 0
        let updatedCoverCount = 0
        setTracks(prev => {
            const merged = [...prev]
            const indexByStreamUrl = new Map(prev.map((item, index) => [item.streamUrl, index]))
            for (const item of incoming) {
                const existedIndex = indexByStreamUrl.get(item.streamUrl)
                if (typeof existedIndex === 'number') {
                    const existed = merged[existedIndex]
                    if (existed && !existed.coverUrl && item.coverUrl) {
                        merged[existedIndex] = { ...existed, coverUrl: item.coverUrl }
                        updatedCoverCount += 1
                    }
                } else {
                    indexByStreamUrl.set(item.streamUrl, merged.length)
                    merged.push(item)
                    addedCount += 1
                }
            }
            return merged
        })
        setCurrentIndex(prev => (prev >= 0 ? prev : 0))
        if (addedCount > 0 || updatedCoverCount > 0) {
            setError(null)
        } else if (!options?.suppressNoopError) {
            setError('These tracks are already in the list')
        }
    }

    const readAudioTracksFromDirectory = async (directoryUri: string) => {
        const uris = (await FileSystem.StorageAccessFramework.readDirectoryAsync(directoryUri)) as string[]
        const coverMap = resolveDirectoryCoverMap(uris)
        return await Promise.all(
            uris
                .filter(uri => AUDIO_EXTENSIONS.has(getFileExtension(uri)))
                .map(async uri => {
                    const stem = getFileBaseName(uri).toLowerCase()
                    const fallbackCover = coverMap.coverSuffixStem.get(stem) ?? coverMap.exactStemCover.get(stem) ?? coverMap.sharedCover
                    const embeddedCover = await extractEmbeddedCoverDataUriFromAudioUri(uri)
                    const coverUrl = embeddedCover ?? fallbackCover
                    return createLocalTrack(uri, getFileName(uri), coverUrl)
                })
        )
    }

    const importFromDirectoryUris = async (incomingDirectoryUris: string[]) => {
        if (!FileSystem.StorageAccessFramework) return { imported: [] as Track[], readableDirectoryUris: [] as string[] }

        const imported: Track[] = []
        const readableDirectoryUris: string[] = []
        for (const directoryUri of normalizeDirectoryUris(incomingDirectoryUris)) {
            try {
                const nextTracks = await readAudioTracksFromDirectory(directoryUri)
                imported.push(...nextTracks)
                readableDirectoryUris.push(directoryUri)
            } catch {
                continue
            }
        }
        return { imported, readableDirectoryUris }
    }

    const importAudioFiles = async () => {
        if (Platform.OS !== 'android') {
            setError('当前仅支持 Android 导入')
            return
        }

        const result = await DocumentPicker.getDocumentAsync({
            type: 'audio/*',
            multiple: true,
            copyToCacheDirectory: false,
        })
        if (result.canceled) return

        const candidates = result.assets.filter(item => {
            if (item.mimeType?.startsWith('audio/')) return true
            const ext = getFileExtension(item.uri)
            return AUDIO_EXTENSIONS.has(ext)
        })
        const nextTracks = await Promise.all(
            candidates.map(async item => {
                const embeddedCover = await extractEmbeddedCoverDataUriFromAudioUri(item.uri)
                return createLocalTrack(item.uri, item.name, embeddedCover)
            })
        )

        appendLocalTracks(nextTracks)
    }

    const importAudioDirectory = async () => {
        if (Platform.OS !== 'android') {
            setError('当前仅支持 Android 导入')
            return
        }
        if (!FileSystem.StorageAccessFramework) {
            setError('当前环境不支持 Android StorageAccessFramework')
            return
        }

        const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync()
        if (!permission.granted || !permission.directoryUri) return

        const { imported, readableDirectoryUris } = await importFromDirectoryUris([permission.directoryUri])
        const nextTracks = imported

        appendLocalTracks(nextTracks)
        if (readableDirectoryUris.length > 0) {
            setDirectoryUris(prev => normalizeDirectoryUris([...prev, ...readableDirectoryUris]))
        }
    }

    const closeNetworkForm = () => {
        setNetworkFormVisible(false)
        setNetworkFormUrl('')
        setNetworkFormTitle('')
        setNetworkFormArtist('')
        setNetworkFormLyricUrl('')
    }

    const importNetworkMusic = () => {
        const trimmedUrl = networkFormUrl.trim()
        const trimmedTitle = networkFormTitle.trim()
        const trimmedArtist = networkFormArtist.trim()
        const trimmedLyricUrl = networkFormLyricUrl.trim()
        if (!trimmedUrl) {
            setError('请输入网络音乐 URL')
            return
        }
        if (!/^https?:\/\//i.test(trimmedUrl)) {
            setError('网络音乐 URL 必须以 http:// 或 https:// 开头')
            return
        }
        if (trimmedLyricUrl && !/^https?:\/\//i.test(trimmedLyricUrl)) {
            setError('歌词 URL 必须以 http:// 或 https:// 开头')
            return
        }

        const nextNetworkTrack: NetworkTrackSetting = {
            url: trimmedUrl,
            title: trimmedTitle || undefined,
            artist: trimmedArtist || undefined,
            lyricUrl: trimmedLyricUrl || undefined,
        }

        const nextTrack: Track = createNetworkTrack(nextNetworkTrack)
        appendLocalTracks([nextTrack])
        setNetworkTracks(prev => normalizeNetworkTrackSettings([...prev, nextNetworkTrack]))
        closeNetworkForm()
        setAddMenuVisible(false)
    }

    useEffect(() => {
        let cancelled = false
        const hydrateSettings = async () => {
            const settings = await loadMobileSettings()
            if (cancelled) return
            setDirectoryUris(settings.directoryUris)
            setNetworkTracks(settings.networkTracks)

            const { imported, readableDirectoryUris } = await importFromDirectoryUris(settings.directoryUris)
            if (cancelled) return

            appendLocalTracks(imported, { suppressNoopError: true })
            appendLocalTracks(
                settings.networkTracks.map(item => createNetworkTrack(item)),
                { suppressNoopError: true }
            )
            if (readableDirectoryUris.length !== settings.directoryUris.length) {
                setDirectoryUris(readableDirectoryUris)
                setError(prev => prev ?? '部分目录访问权限已失效，请重新添加目录')
            }
            setSettingsHydrated(true)
        }
        void hydrateSettings()
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        if (!settingsHydrated) return
        void saveMobileSettings({ directoryUris, networkTracks }).catch(() => {
            setError(prev => prev ?? '目录配置保存失败')
        })
    }, [directoryUris, networkTracks, settingsHydrated])

    const openMenu = () => {
        setMenuVisible(true)
        Animated.timing(menuAnim, {
            toValue: 1,
            duration: 220,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start()
    }

    const closeMenu = () => {
        Animated.timing(menuAnim, {
            toValue: 0,
            duration: 180,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (finished) setMenuVisible(false)
        })
    }

    const handleProgressLayout = (event: LayoutChangeEvent) => {
        setProgressWidth(event.nativeEvent.layout.width)
    }

    const resolvePositionByX = (locationX: number) => {
        if (progressWidth <= 0 || durationMs <= 0) return 0
        const ratio = Math.max(0, Math.min(1, locationX / progressWidth))
        return ratio * durationMs
    }

    const commitSeekTo = async (nextPosition: number) => {
        if (!soundRef.current || durationMs <= 0) return
        await soundRef.current.setPositionAsync(nextPosition)
        setPositionMs(nextPosition)
    }

    const onSeekStart = (event: GestureResponderEvent) => {
        if (durationMs <= 0) return
        const next = resolvePositionByX(event.nativeEvent.locationX)
        setIsSeeking(true)
        setSeekPreviewMs(next)
    }

    const onSeekMove = (event: GestureResponderEvent) => {
        if (!isSeeking) return
        const next = resolvePositionByX(event.nativeEvent.locationX)
        setSeekPreviewMs(next)
    }

    const onSeekEnd = (event: GestureResponderEvent) => {
        if (durationMs <= 0) return
        const next = isSeeking ? seekPreviewMs : resolvePositionByX(event.nativeEvent.locationX)
        setIsSeeking(false)
        void commitSeekTo(next)
    }

    const modeIcon = playMode === 'sequential' ? 'repeat' : playMode === 'random' ? 'shuffle' : 'repeat-once'
    const recordRotate = recordSpinAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    })

    return (
        <SafeAreaView style={[styles.screen, Platform.OS === 'android' ? { paddingTop: 10 + androidTopOffset } : undefined]}>
            <StatusBar style="light" />

            <View style={styles.header}>
                <Pressable style={styles.menuButton} onPress={openMenu}>
                    <Ionicons name="menu" size={22} color="#fff" />
                </Pressable>
                <View>
                    <Text style={styles.headerTitle}>白泽音乐</Text>
                    <Text style={styles.headerSub}>
                        队列 {queueCursor >= 0 ? queueCursor + 1 : '-'} / {effectiveQueueIds.length}
                    </Text>
                </View>
            </View>

            {!!error && <Text style={styles.errorText}>{error}</Text>}
            <View style={styles.centerArea}>
                <View style={styles.lyricArea}>
                    {lyricPreview.map((line, index) => (
                        <Text
                            key={`${line}-${index}`}
                            style={[
                                styles.lyricLine,
                                index === 1 && activeLyricIndex >= 0 ? styles.lyricActive : undefined,
                                line ? undefined : styles.lyricHidden,
                            ]}
                            numberOfLines={1}
                        >
                            {line || '.'}
                        </Text>
                    ))}
                </View>

                <View style={styles.recordWrap}>
                    <Animated.View style={[styles.recordRing, { transform: [{ rotate: recordRotate }] }]}>
                        <View style={styles.recordInner} />
                        {currentTrack?.coverUrl ? (
                            <Image source={{ uri: currentTrack.coverUrl }} style={styles.cover} resizeMode="cover" />
                        ) : (
                            <View style={styles.coverPlaceholder}>
                                <MaterialCommunityIcons name="music-note" size={34} color="#9ca3af" />
                            </View>
                        )}
                    </Animated.View>
                </View>
            </View>

            <View style={styles.playerArea}>
                <Text numberOfLines={1} style={styles.trackTitle}>
                    {currentTrack?.title ?? '未选择歌曲'}
                </Text>
                <Text numberOfLines={1} style={styles.trackArtist}>
                    {currentTrack?.artist ?? '-'}
                </Text>

                <View
                    style={styles.progressTrack}
                    onLayout={handleProgressLayout}
                    onStartShouldSetResponder={() => true}
                    onMoveShouldSetResponder={() => true}
                    onResponderGrant={onSeekStart}
                    onResponderMove={onSeekMove}
                    onResponderRelease={onSeekEnd}
                >
                    <View pointerEvents="none" style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
                    <View pointerEvents="none" style={[styles.progressThumb, { left: `${progressRatio * 100}%` }]} />
                </View>
                <Text style={styles.progressTime}>
                    {formatTime(uiPositionMs / 1000)} / {formatTime(durationMs / 1000)}
                </Text>

                <View style={styles.controls}>
                    <Pressable style={styles.smallButton} onPress={togglePlayMode}>
                        <MaterialCommunityIcons name={modeIcon} size={20} color="#e5e7eb" />
                    </Pressable>
                    <Pressable style={styles.smallButton} onPress={() => void playPrev()}>
                        <Ionicons name="play-skip-back" size={20} color="#e5e7eb" />
                    </Pressable>
                    <Pressable style={styles.playButton} onPress={() => void togglePlayPause()}>
                        <Ionicons name={isPlaying ? 'pause' : 'play'} size={28} color="#fff" />
                    </Pressable>
                    <Pressable style={styles.smallButton} onPress={() => void playNext()}>
                        <Ionicons name="play-skip-forward" size={20} color="#e5e7eb" />
                    </Pressable>
                    <Pressable style={styles.smallButton} onPress={() => setPlaylistVisible(true)}>
                        <Ionicons name="list" size={20} color="#e5e7eb" />
                    </Pressable>
                </View>
            </View>

            {menuVisible && (
                <View style={styles.menuOverlayWrap}>
                    <Pressable style={styles.menuMask} onPress={closeMenu} />
                    <Animated.View
                        style={[
                            styles.menuPanel,
                            {
                                transform: [
                                    {
                                        translateX: menuAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [-320, 0],
                                        }),
                                    },
                                ],
                            },
                        ]}
                    >
                        <View style={styles.menuHeaderRow}>
                            <Text style={styles.menuTitle}>歌曲列表</Text>
                            <Pressable
                                style={styles.menuAddToggleButton}
                                onPress={() => {
                                    setAddMenuVisible(prev => !prev)
                                    if (addMenuVisible) {
                                        closeNetworkForm()
                                    }
                                }}
                            >
                                <Ionicons name={addMenuVisible ? 'close' : 'add'} size={18} color="#dbeafe" />
                            </Pressable>
                        </View>
                        {addMenuVisible && (
                            <View style={styles.addMenuPanel}>
                                <Pressable
                                    style={styles.importButton}
                                    onPress={() => {
                                        void importAudioDirectory()
                                        setAddMenuVisible(false)
                                        closeNetworkForm()
                                    }}
                                >
                                    <Ionicons name="folder-open" size={14} color="#dbeafe" />
                                    <Text style={styles.importButtonText}>添加目录</Text>
                                </Pressable>
                                <Pressable
                                    style={styles.importButton}
                                    onPress={() => {
                                        void importAudioFiles()
                                        setAddMenuVisible(false)
                                        closeNetworkForm()
                                    }}
                                >
                                    <Ionicons name="add-circle" size={14} color="#dbeafe" />
                                    <Text style={styles.importButtonText}>添加歌曲</Text>
                                </Pressable>
                                <Pressable
                                    style={styles.importButton}
                                    onPress={() => {
                                        setNetworkFormVisible(true)
                                        setAddMenuVisible(false)
                                    }}
                                >
                                    <Ionicons name="globe-outline" size={14} color="#dbeafe" />
                                    <Text style={styles.importButtonText}>添加网络音乐</Text>
                                </Pressable>
                            </View>
                        )}
                        <TextInput
                            value={songSearchKeyword}
                            onChangeText={setSongSearchKeyword}
                            placeholder="搜索歌曲/歌手/专辑"
                            placeholderTextColor="#94a3b8"
                            style={styles.songSearchInput}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <FlatList
                            data={filteredTracks}
                            keyExtractor={item => item.id}
                            ListEmptyComponent={
                                <Text style={styles.menuEmpty}>{songSearchKeyword.trim() ? '未找到匹配歌曲' : '暂无歌曲'}</Text>
                            }
                            renderItem={({ item }) => {
                                const inPlaylist = playlistTrackIds.includes(item.id)
                                const active = currentTrack?.id === item.id
                                return (
                                    <View style={styles.songItemRow}>
                                        <Pressable
                                            style={[styles.songItemLeft, active && styles.songItemLeftActive]}
                                            onPress={() => {
                                                const found = trackMap.get(item.id)
                                                if (found) {
                                                    void playTrack(found.index)
                                                }
                                                closeMenu()
                                            }}
                                        >
                                            <Text numberOfLines={1} style={styles.songItemTitle}>
                                                {item.title}
                                            </Text>
                                            <Text numberOfLines={1} style={styles.songItemMeta}>
                                                {item.artist}
                                            </Text>
                                        </Pressable>
                                        <View style={styles.songActionButtons}>
                                            <Pressable style={styles.songAddButton} onPress={() => addTrackToPlaylist(item)}>
                                                <Ionicons name={inPlaylist ? 'checkmark' : 'add'} size={18} color="#fff" />
                                            </Pressable>
                                            <Pressable style={styles.songDeleteButton} onPress={() => void removeTrackFromLibrary(item.id)}>
                                                <Ionicons name="trash-outline" size={16} color="#fff" />
                                            </Pressable>
                                        </View>
                                    </View>
                                )
                            }}
                        />
                    </Animated.View>
                </View>
            )}

            <Modal visible={networkFormVisible} transparent animationType="fade" onRequestClose={closeNetworkForm}>
                <View style={styles.networkFormOverlay}>
                    <Pressable style={styles.networkFormMask} onPress={closeNetworkForm} />
                    <View style={styles.networkFormCard}>
                        <Text style={styles.networkFormTitle}>添加网络音乐</Text>
                        <TextInput
                            value={networkFormUrl}
                            onChangeText={setNetworkFormUrl}
                            placeholder="音乐 URL (必填)"
                            placeholderTextColor="#94a3b8"
                            style={styles.networkInput}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <TextInput
                            value={networkFormTitle}
                            onChangeText={setNetworkFormTitle}
                            placeholder="歌曲名字 (选填)"
                            placeholderTextColor="#94a3b8"
                            style={styles.networkInput}
                        />
                        <TextInput
                            value={networkFormArtist}
                            onChangeText={setNetworkFormArtist}
                            placeholder="作者 (选填)"
                            placeholderTextColor="#94a3b8"
                            style={styles.networkInput}
                        />
                        <TextInput
                            value={networkFormLyricUrl}
                            onChangeText={setNetworkFormLyricUrl}
                            placeholder="歌词 URL (选填)"
                            placeholderTextColor="#94a3b8"
                            style={styles.networkInput}
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <View style={styles.networkFormActions}>
                            <Pressable style={[styles.networkSubmitButton, styles.networkCancelButton]} onPress={closeNetworkForm}>
                                <Text style={styles.networkSubmitText}>取消</Text>
                            </Pressable>
                            <Pressable style={styles.networkSubmitButton} onPress={importNetworkMusic}>
                                <Text style={styles.networkSubmitText}>确认添加</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>

            {playlistVisible && (
                <View style={styles.playlistOverlay}>
                    <Pressable style={styles.playlistMask} onPress={() => setPlaylistVisible(false)} />
                    <View style={styles.playlistPanel}>
                        <View style={styles.playlistHeader}>
                            <Text style={styles.playlistTitle}>播放列表 ({playlistTracks.length})</Text>
                            <View style={styles.playlistActions}>
                                <Pressable style={styles.playlistActionBtn} onPress={clearPlaylist}>
                                    <Text style={styles.playlistActionText}>清空</Text>
                                </Pressable>
                                <Pressable style={styles.playlistActionBtn} onPress={() => setPlaylistVisible(false)}>
                                    <Text style={styles.playlistActionText}>关闭</Text>
                                </Pressable>
                            </View>
                        </View>

                        <FlatList
                            data={playlistTracks}
                            keyExtractor={item => item.id}
                            ListEmptyComponent={<Text style={styles.menuEmpty}>No tracks in playlist</Text>}
                            renderItem={({ item }) => (
                                <View style={styles.playlistItemRow}>
                                    <Pressable
                                        style={styles.playlistItemPlay}
                                        onPress={() => {
                                            const found = trackMap.get(item.id)
                                            if (found) {
                                                void playTrack(found.index)
                                            }
                                            setPlaylistVisible(false)
                                        }}
                                    >
                                        <Text numberOfLines={1} style={styles.playlistItemText}>
                                            {item.title}
                                        </Text>
                                    </Pressable>
                                    <Pressable style={styles.playlistItemRemove} onPress={() => removeTrackFromPlaylist(item.id)}>
                                        <Ionicons name="close" size={16} color="#fecaca" />
                                    </Pressable>
                                </View>
                            )}
                        />
                    </View>
                </View>
            )}
        </SafeAreaView>
    )
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: '#090f1d',
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 14,
    },
    header: {
        height: 54,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    menuButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: '#1f2937',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '700',
    },
    headerSub: {
        color: '#93c5fd',
        fontSize: 12,
        marginTop: 2,
    },
    errorText: {
        color: '#fca5a5',
        fontSize: 12,
        marginTop: 6,
    },
    centerArea: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 8,
    },
    lyricArea: {
        width: '100%',
        minHeight: 74,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 14,
    },
    lyricLine: {
        color: '#94a3b8',
        fontSize: 14,
        lineHeight: 24,
        maxWidth: '92%',
    },
    lyricActive: {
        color: '#f8fafc',
        fontWeight: '700',
        fontSize: 15,
    },
    lyricHidden: {
        color: 'transparent',
    },
    recordWrap: {
        width: 336,
        height: 336,
        alignItems: 'center',
        justifyContent: 'center',
    },
    recordRing: {
        width: 308,
        height: 308,
        borderRadius: 154,
        backgroundColor: '#111827',
        borderWidth: 2,
        borderColor: '#1f2937',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowOffset: { width: 0, height: 8 },
        shadowRadius: 12,
        elevation: 5,
    },
    recordInner: {
        position: 'absolute',
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: '#020617',
        borderWidth: 2,
        borderColor: '#334155',
    },
    cover: {
        width: 204,
        height: 204,
        borderRadius: 102,
    },
    coverPlaceholder: {
        width: 204,
        height: 204,
        borderRadius: 102,
        backgroundColor: '#1f2937',
        alignItems: 'center',
        justifyContent: 'center',
    },
    playerArea: {
        paddingTop: 10,
    },
    trackTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '700',
        textAlign: 'center',
    },
    trackArtist: {
        color: '#cbd5e1',
        fontSize: 13,
        textAlign: 'center',
        marginTop: 4,
        marginBottom: 10,
    },
    progressTrack: {
        height: 16,
        borderRadius: 8,
        backgroundColor: '#334155',
        justifyContent: 'center',
        overflow: 'visible',
    },
    progressFill: {
        position: 'absolute',
        left: 0,
        top: 4,
        bottom: 4,
        borderRadius: 4,
        backgroundColor: '#38bdf8',
    },
    progressThumb: {
        position: 'absolute',
        top: 1,
        width: 14,
        height: 14,
        marginLeft: -7,
        borderRadius: 7,
        backgroundColor: '#e0f2fe',
    },
    progressTime: {
        marginTop: 6,
        color: '#94a3b8',
        fontSize: 12,
        textAlign: 'center',
    },
    controls: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 14,
    },
    smallButton: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: '#1f2937',
        alignItems: 'center',
        justifyContent: 'center',
    },
    playButton: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#2563eb',
        alignItems: 'center',
        justifyContent: 'center',
    },
    menuOverlayWrap: {
        ...StyleSheet.absoluteFillObject,
        flexDirection: 'row',
        zIndex: 1200,
        elevation: 1200,
    },
    menuMask: {
        flex: 1,
        backgroundColor: 'rgba(2,6,23,0.45)',
    },
    menuPanel: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: '82%',
        maxWidth: 320,
        backgroundColor: '#0f172a',
        paddingTop: 58,
        paddingHorizontal: 12,
        zIndex: 1201,
        elevation: 1201,
    },
    menuTitle: {
        color: '#fff',
        fontSize: 17,
        fontWeight: '700',
    },
    menuHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    menuAddToggleButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1d4ed8',
    },
    addMenuPanel: {
        gap: 8,
        marginBottom: 10,
    },
    importButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        backgroundColor: '#1d4ed8',
        borderRadius: 8,
        paddingVertical: 7,
    },
    importButtonText: {
        color: '#dbeafe',
        fontSize: 12,
        fontWeight: '600',
    },
    networkInputWrap: {
        gap: 8,
        backgroundColor: '#1e293b',
        borderRadius: 8,
        padding: 8,
    },
    networkInput: {
        backgroundColor: '#0f172a',
        borderWidth: 1,
        borderColor: '#334155',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        color: '#e2e8f0',
        fontSize: 12,
    },
    networkSubmitButton: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0369a1',
        borderRadius: 8,
        paddingVertical: 8,
    },
    networkSubmitText: {
        color: '#e0f2fe',
        fontSize: 12,
        fontWeight: '700',
    },
    networkCancelButton: {
        backgroundColor: '#475569',
    },
    networkFormOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1400,
        elevation: 1400,
    },
    networkFormMask: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(2,6,23,0.5)',
    },
    networkFormCard: {
        width: '88%',
        maxWidth: 360,
        backgroundColor: '#0f172a',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#1e293b',
        padding: 14,
        gap: 10,
    },
    networkFormTitle: {
        color: '#e2e8f0',
        fontSize: 15,
        fontWeight: '700',
        marginBottom: 2,
    },
    networkFormActions: {
        flexDirection: 'row',
        gap: 8,
    },
    songSearchInput: {
        backgroundColor: '#0f172a',
        borderWidth: 1,
        borderColor: '#334155',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        color: '#e2e8f0',
        fontSize: 12,
        marginBottom: 10,
    },
    menuEmpty: {
        color: '#94a3b8',
        textAlign: 'center',
        marginTop: 18,
    },
    songItemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    },
    songItemLeft: {
        flex: 1,
        backgroundColor: '#1e293b',
        borderRadius: 10,
        paddingVertical: 10,
        paddingHorizontal: 10,
    },
    songItemLeftActive: {
        backgroundColor: '#1d4ed8',
    },
    songItemTitle: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    songItemMeta: {
        color: '#cbd5e1',
        fontSize: 12,
        marginTop: 2,
    },
    songAddButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#0ea5e9',
        alignItems: 'center',
        justifyContent: 'center',
    },
    songActionButtons: {
        gap: 6,
    },
    songDeleteButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#dc2626',
        alignItems: 'center',
        justifyContent: 'center',
    },
    playlistOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'flex-end',
        zIndex: 1200,
        elevation: 1200,
    },
    playlistMask: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(2,6,23,0.45)',
    },
    playlistPanel: {
        backgroundColor: '#111827',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        padding: 12,
        maxHeight: '52%',
    },
    playlistHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    playlistTitle: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
    },
    playlistActions: {
        flexDirection: 'row',
        gap: 8,
    },
    playlistActionBtn: {
        backgroundColor: '#1f2937',
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 5,
    },
    playlistActionText: {
        color: '#e2e8f0',
        fontSize: 12,
    },
    playlistItemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    },
    playlistItemPlay: {
        flex: 1,
        backgroundColor: '#1f2937',
        borderRadius: 10,
        paddingVertical: 10,
        paddingHorizontal: 10,
    },
    playlistItemText: {
        color: '#f8fafc',
        fontSize: 13,
    },
    playlistItemRemove: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#7f1d1d',
        alignItems: 'center',
        justifyContent: 'center',
    },
})
