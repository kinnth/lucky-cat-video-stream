import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { nakamaAuth, getUser } from './middleware/nakama-auth'
import { generateSignedUrl } from './services/stream-signed-url'
import { analyzeVideo, generateThumbnailUrls } from './services/openrouter-analysis'

type Bindings = {
    NAKAMA_URL: string
    LUCKYCAT_API_URL: string
    CLOUDFLARE_ACCOUNT_ID: string
    CLOUDFLARE_STREAM_API_TOKEN: string
    CLOUDFLARE_STREAM_SIGNING_KEY_ID: string
    CLOUDFLARE_STREAM_SIGNING_KEY_PEM: string
    OPENROUTER_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS for Flutter app
app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}))

// Health check (public)
app.get('/', (c) => {
    return c.json({
        service: 'LuckyCat Video Stream',
        status: 'healthy',
        version: '1.0.0'
    })
})

// Protected routes - require Nakama auth
app.use('/videos/*', nakamaAuth)

// List videos for authenticated user
app.get('/videos', async (c) => {
    const user = getUser(c)
    // TODO: Fetch from Lucky Cat API
    return c.json({
        user_id: user.user_id,
        videos: [],
        message: 'Video list endpoint - implementation pending'
    })
})

// Get video metadata
app.get('/videos/:id', async (c) => {
    const videoId = c.req.param('id')
    const user = getUser(c)
    // TODO: Fetch from Lucky Cat API
    return c.json({
        id: videoId,
        user_id: user.user_id,
        message: 'Video metadata endpoint - implementation pending'
    })
})

// Generate signed playback URL
app.post('/videos/:id/token', async (c) => {
    const videoId = c.req.param('id')
    const user = getUser(c)

    // Check if signing key is configured
    if (!c.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID || !c.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM) {
        return c.json({
            error: 'Signing keys not configured',
            message: 'Please set CLOUDFLARE_STREAM_SIGNING_KEY_ID and CLOUDFLARE_STREAM_SIGNING_KEY_PEM secrets'
        }, 500)
    }

    // TODO: Validate user has access to this video via Lucky Cat API

    try {
        const signedUrl = await generateSignedUrl(
            { videoId, expiresInSeconds: 7200 },
            {
                CLOUDFLARE_STREAM_SIGNING_KEY_ID: c.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
                CLOUDFLARE_STREAM_SIGNING_KEY_PEM: c.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM,
                CLOUDFLARE_ACCOUNT_ID: c.env.CLOUDFLARE_ACCOUNT_ID,
            }
        )

        return c.json({
            video_id: videoId,
            user_id: user.user_id,
            ...signedUrl
        })
    } catch (error) {
        console.error('Signed URL generation error:', error)
        return c.json({
            error: 'Failed to generate signed URL',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500)
    }
})

// Get video processing status from Cloudflare Stream
app.get('/status/:uid', async (c) => {
    const uid = c.req.param('uid')

    // Simple auth check
    const authHeader = c.req.header('Authorization')
    if (!authHeader) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    try {
        const streamUrl = `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}`

        console.log(`[STATUS] Checking video status for ${uid}`)

        const response = await fetch(streamUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${c.env.CLOUDFLARE_STREAM_API_TOKEN}`,
            }
        })

        if (!response.ok) {
            const errText = await response.text()
            console.error(`[STATUS] Stream API error: ${errText}`)
            return c.json({
                error: 'Video not found or API error',
                details: errText
            }, response.status === 404 ? 404 : 502)
        }

        const data = await response.json() as {
            result: {
                uid: string
                status: { state: string; pctComplete?: string; errorReasonCode?: string; errorReasonText?: string }
                readyToStream: boolean
                readyToStreamAt?: string
                duration?: number
                size?: number
                input?: { width?: number; height?: number }
                thumbnail?: string
                created?: string
                modified?: string
            }
        }

        const video = data.result

        console.log(`[STATUS] Video ${uid}: state=${video.status.state}, ready=${video.readyToStream}, pct=${video.status.pctComplete || 'N/A'}`)

        return c.json({
            uid: video.uid,
            state: video.status.state,
            readyToStream: video.readyToStream,
            readyToStreamAt: video.readyToStreamAt,
            pctComplete: video.status.pctComplete,
            duration: video.duration,
            size: video.size,
            dimensions: video.input ? `${video.input.width}x${video.input.height}` : null,
            thumbnail: video.thumbnail,
            error: video.status.errorReasonCode ? {
                code: video.status.errorReasonCode,
                message: video.status.errorReasonText
            } : null,
            created: video.created,
            modified: video.modified
        })

    } catch (error) {
        console.error('[STATUS] Error:', error)
        return c.json({
            error: 'Failed to get status',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500)
    }
})

// Admin/Migration: Ingest video from URL
app.post('/upload/url', async (c) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    try {
        const body = await c.req.json() as { url: string; meta?: Record<string, string> }

        if (!body.url) {
            return c.json({ error: 'Missing URL' }, 400)
        }

        console.log('[UPLOAD] Starting upload for URL:', body.url.substring(0, 100) + '...')

        // First, try the /copy endpoint (works for URLs that support HEAD/range requests)
        const copyUrl = `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/stream/copy`

        console.log('[UPLOAD] Attempting URL copy method...')
        const copyResponse = await fetch(copyUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${c.env.CLOUDFLARE_STREAM_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: body.url,
                meta: {
                    ...body.meta,
                    source: 'dailymotion-migration'
                },
                requireSignedURLs: true
            })
        })

        if (copyResponse.ok) {
            const data = await copyResponse.json() as { result: { uid: string; thumbnail: string } }
            console.log('[UPLOAD] Copy method succeeded, UID:', data.result.uid)
            return c.json({
                success: true,
                uid: data.result.uid,
                thumbnail: data.result.thumbnail,
                method: 'copy',
                message: 'Video upload queued via URL copy'
            })
        }

        // Copy failed, try streaming through the worker
        console.log('[UPLOAD] Copy failed, attempting stream-through method...')
        const copyError = await copyResponse.text()
        console.log('[UPLOAD] Copy error:', copyError)

        // Download the video
        console.log('[UPLOAD] Fetching video from source...')
        const videoResponse = await fetch(body.url)

        if (!videoResponse.ok) {
            console.error('[UPLOAD] Failed to fetch source video:', videoResponse.status)
            return c.json({
                error: 'Failed to fetch source video',
                details: `Source returned ${videoResponse.status}`
            }, 502)
        }

        const contentLength = videoResponse.headers.get('content-length')
        const contentType = videoResponse.headers.get('content-type') || 'video/mp4'
        console.log('[UPLOAD] Source video fetched, size:', contentLength, 'type:', contentType)

        // Check size limit (Workers have ~128MB limit, but let's be safe)
        if (contentLength && parseInt(contentLength) > 100 * 1024 * 1024) {
            console.error('[UPLOAD] Video too large for stream-through:', contentLength)
            return c.json({
                error: 'Video too large for stream-through upload',
                details: 'Max size is 100MB. Use direct upload for larger files.',
                size: contentLength
            }, 413)
        }

        // Create upload URL via TUS
        console.log('[UPLOAD] Creating TUS upload URL...')
        const tusUrl = `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/stream?direct_user=true`

        const tusHeadersObj: Record<string, string> = {
            'Authorization': `Bearer ${c.env.CLOUDFLARE_STREAM_API_TOKEN}`,
            'Tus-Resumable': '1.0.0',
            'Upload-Metadata': `requiresignedurls dHJ1ZQ==, name ${btoa(body.meta?.dm_id || 'video')}`
        }

        if (contentLength) {
            tusHeadersObj['Upload-Length'] = contentLength
        }

        const tusResponse = await fetch(tusUrl, {
            method: 'POST',
            headers: tusHeadersObj
        })

        if (!tusResponse.ok) {
            const tusError = await tusResponse.text()
            console.error('[UPLOAD] TUS creation failed:', tusError)
            return c.json({ error: 'Failed to create upload URL', details: tusError }, 502)
        }

        const uploadUrl = tusResponse.headers.get('location') || tusResponse.headers.get('stream-media-id')
        const streamMediaId = tusResponse.headers.get('stream-media-id')

        console.log('[UPLOAD] TUS URL created:', uploadUrl?.substring(0, 80) + '...')
        console.log('[UPLOAD] Stream Media ID:', streamMediaId)

        if (!uploadUrl) {
            return c.json({ error: 'No upload URL in TUS response' }, 502)
        }

        // Upload the video data via TUS PATCH
        console.log('[UPLOAD] Uploading video data via TUS PATCH...')
        const videoData = await videoResponse.arrayBuffer()

        const patchResponse = await fetch(uploadUrl, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/offset+octet-stream',
                'Upload-Offset': '0',
                'Tus-Resumable': '1.0.0'
            },
            body: videoData
        })

        if (!patchResponse.ok) {
            const patchError = await patchResponse.text()
            console.error('[UPLOAD] TUS PATCH failed:', patchError)
            return c.json({ error: 'Video upload failed', details: patchError }, 502)
        }

        console.log('[UPLOAD] Stream-through upload succeeded!')

        // Extract UID from the upload URL
        const uid = streamMediaId || uploadUrl.split('/').pop()?.split('?')[0] || 'unknown'

        return c.json({
            success: true,
            uid,
            method: 'stream-through',
            size: contentLength,
            message: 'Video uploaded via stream-through'
        })

    } catch (error) {
        console.error('Upload error:', error)
        return c.json({ error: 'Upload failed', details: error instanceof Error ? error.message : String(error) }, 500)
    }
})

// Cloudflare Stream webhook handler
app.post('/webhook', async (c) => {
    try {
        const body = await c.req.json() as {
            uid: string
            readyToStream: boolean
            status: { state: string }
        }

        console.log('Webhook received:', JSON.stringify(body))

        if (body.readyToStream) {
            // Video is ready for streaming
            console.log(`Video ${body.uid} is ready to stream`)
            // TODO: Trigger AI analysis automatically
        }

        return c.json({ received: true, uid: body.uid })
    } catch (error) {
        console.error('Webhook error:', error)
        return c.json({ error: 'Webhook processing failed' }, 500)
    }
})

// AI Analysis endpoint - analyze video keyframes with OpenRouter
app.post('/analyze/:uid', async (c) => {
    const uid = c.req.param('uid')

    // Simple auth check
    const authHeader = c.req.header('Authorization')
    if (!authHeader) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    if (!c.env.OPENROUTER_API_KEY) {
        return c.json({ error: 'OpenRouter API key not configured' }, 500)
    }

    try {
        // Generate thumbnail URLs for the video
        const thumbnailUrls = generateThumbnailUrls(
            uid,
            c.env.CLOUDFLARE_ACCOUNT_ID,
            8
        )

        console.log(`Analyzing video ${uid} with ${thumbnailUrls.length} keyframes`)

        // Call OpenRouter for analysis
        const analysis = await analyzeVideo(
            {
                videoId: uid,
                thumbnailUrls
            },
            c.env.OPENROUTER_API_KEY
        )

        return c.json({
            success: true,
            uid,
            analysis
        })

    } catch (error) {
        console.error('Analysis error:', error)
        return c.json({
            error: 'Analysis failed',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500)
    }
})

export default app
