import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

import type { TrackListResponse } from '@baize/types'
import cors from 'cors'
import express from 'express'

import { findTrackAssetById, scanTracks } from './music/scanTracks.js'

const app = express()
const port = Number(process.env.PORT ?? 3000)

app.use(cors())
app.use(express.json())

app.get('/api/health', (_req, res) => {
    res.json({
        ok: true,
        service: '@baize/server',
    })
})

app.get('/api/tracks', (_req, res) => {
    scanTracks()
        .then(tracks => {
            const payload: TrackListResponse = { tracks }
            res.json(payload)
        })
        .catch((error: unknown) => {
            console.error('failed to scan tracks', error)
            res.status(500).json({
                message: 'failed to scan tracks',
            })
        })
})

app.get('/api/tracks/:id/stream', async (req, res) => {
    try {
        const track = await findTrackAssetById(req.params.id)
        if (!track) {
            res.status(404).json({ message: 'track not found' })
            return
        }

        const filePath = track.audioFilePath
        const fileStat = await stat(filePath)
        const fileSize = fileStat.size
        const range = req.headers.range
        const ext = path.extname(filePath).slice(1).toLowerCase()
        const contentType = ext === 'mp3' ? 'audio/mpeg' : `audio/${ext || 'mpeg'}`

        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Type', contentType)

        if (!range) {
            res.setHeader('Content-Length', fileSize)
            createReadStream(filePath).pipe(res)
            return
        }

        const parts = range.replace(/bytes=/, '').split('-')
        const start = Number(parts[0])
        const end = parts[1] ? Number(parts[1]) : fileSize - 1

        if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize) {
            res.status(416).end()
            return
        }

        const chunkSize = end - start + 1
        res.status(206)
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`)
        res.setHeader('Content-Length', chunkSize)
        createReadStream(filePath, { start, end }).pipe(res)
    } catch (error: unknown) {
        console.error('failed to stream track', error)
        res.status(500).json({ message: 'failed to stream track' })
    }
})

app.get('/api/tracks/:id/lyric', async (req, res) => {
    try {
        const track = await findTrackAssetById(req.params.id)
        if (!track || !track.lyricFilePath) {
            res.status(404).json({ message: 'lyric not found' })
            return
        }

        res.sendFile(path.resolve(track.lyricFilePath), {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
            },
        })
    } catch (error: unknown) {
        console.error('failed to read lyric', error)
        res.status(500).json({ message: 'failed to read lyric' })
    }
})

app.get('/api/tracks/:id/cover', async (req, res) => {
    try {
        const track = await findTrackAssetById(req.params.id)
        if (!track) {
            res.status(404).json({ message: 'cover not found' })
            return
        }

        if (track.coverFilePath) {
            const ext = path.extname(track.coverFilePath).slice(1).toLowerCase()
            const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
            res.sendFile(path.resolve(track.coverFilePath), {
                headers: {
                    'Content-Type': mimeType,
                },
            })
            return
        }

        if (track.embeddedCover) {
            res.setHeader('Content-Type', track.embeddedCover.mimeType)
            res.setHeader('Cache-Control', 'public, max-age=300')
            res.status(200).send(Buffer.from(track.embeddedCover.data))
            return
        }

        res.status(404).json({ message: 'cover not found' })
    } catch (error: unknown) {
        console.error('failed to read cover', error)
        res.status(500).json({ message: 'failed to read cover' })
    }
})

app.get('/api/tracks/:id/download', async (req, res) => {
    try {
        const track = await findTrackAssetById(req.params.id)
        if (!track) {
            res.status(404).json({ message: 'track not found' })
            return
        }

        const filePath = track.audioFilePath
        const ext = path.extname(filePath).slice(1).toLowerCase()
        const contentType = ext === 'mp3' ? 'audio/mpeg' : `audio/${ext || 'mpeg'}`
        const filename = path.basename(filePath)

        res.setHeader('Content-Type', contentType)
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
        res.sendFile(path.resolve(filePath))
    } catch (error: unknown) {
        console.error('failed to download track', error)
        res.status(500).json({ message: 'failed to download track' })
    }
})

app.listen(port, () => {
    console.log(`server is listening on http://localhost:${port}`)
})
