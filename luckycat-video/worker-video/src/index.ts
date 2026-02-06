import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { nakamaAuth, getUser } from './middleware/nakama-auth'
import { generateSignedUrl } from './services/stream-signed-url'
import { analyzeVideo, generateThumbnailUrls } from './services/openrouter-analysis'
import { parseVTT } from './utils/vtt-parser'

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

    // Auth check removed for public access
    // if (!c.req.header('Authorization')) return c.json({ error: 'Unauthorized' }, 401)

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
                playback?: { hls?: string; dash?: string }
                requireSignedURLs?: boolean
                created?: string
                modified?: string
            }
        }

        // Safety check to handle unwrapped responses if API differs
        const video = data.result || data // Fallback if result wrapper is missing

        // Fetch captions status
        // We need to know if captions exist to report to the client
        let captions: any[] = []
        try {
            // To check captions, we list them
            const capResponse = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}/captions`,
                {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${c.env.CLOUDFLARE_STREAM_API_TOKEN}` }
                }
            )
            if (capResponse.ok) {
                const capData = await capResponse.json() as any
                captions = capData.result || []
            }
        } catch (e) {
            console.warn('[STATUS] Failed to check captions', e)
        }

        // PUBLIC ACCESS MODE: No signing logic.
        // Directly map public Cloudflare Stream URLs.
        const playbackUrl = video.playback?.hls || null;
        const dashUrl = video.playback?.dash || null;
        const downloadUrl = playbackUrl ? playbackUrl.replace('/manifest/video.m3u8', '/downloads/default.mp4') : null;

        // Generate public thumbnail URL (using default Cloudflare format)
        // https://customer-<id>.cloudflarestream.com/<uid>/thumbnails/thumbnail.jpg?time=Xs&height=600
        const thumbnailBase = video.thumbnail ? video.thumbnail.split('?')[0] : `https://customer-${c.env.CLOUDFLARE_ACCOUNT_ID}.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg`;

        // Generate a few thumbnails for keyframes
        let thumbnails: string[] = [];
        if (video.duration) {
            const duration = video.duration;
            // Generate 8 evenly spaced timestamps
            const times = Array.from({ length: 8 }, (_, i) => (duration * i / 7).toFixed(1));
            thumbnails = times.map(t => `${thumbnailBase}?time=${t}s&height=360`);
        } else {
            thumbnails = [video.thumbnail || `${thumbnailBase}?height=360`];
        }

        // Use custom domain for iframe URL lookup or fallback
        // Extract domain from playback URL if possible
        let domain = `customer-${c.env.CLOUDFLARE_ACCOUNT_ID}.cloudflarestream.com`;
        if (playbackUrl) {
            try {
                domain = new URL(playbackUrl).hostname;
            } catch (e) { /* ignore */ }
        }

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

            // Public URLs mapped to "signed" fields for compatibility with Client
            signedPlaybackUrl: playbackUrl,
            signedDashUrl: dashUrl,
            signedDownloadUrl: downloadUrl,
            signedThumbnails: thumbnails,

            captions: captions, // Return the list of captions

            iframeUrl: video.readyToStream ? `https://${domain}/${video.uid}/iframe` : null,
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

// Generate captions using Cloudflare AI
app.post('/captions/generate/:uid', async (c) => {
    const uid = c.req.param('uid')
    console.log(`[CAPTIONS] Generating AI captions for ${uid}...`)

    try {
        // According to Cloudflare Docs (2024), to generate AI captions:
        // POST accounts/{account_id}/stream/{video_id}/captions
        // Body: { "language": "en", "generated": true }
        // BUT calling it "PUT" with "language/en" sometimes is for uploading VTTs.
        // Let's try the POST method with generated flag which works on newer endpoints.

        // Correct API endpoint for AI generation (per Cloudflare docs):
        // POST .../stream/<UID>/captions/<LANG>/generate
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}/captions/en/generate`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${c.env.CLOUDFLARE_STREAM_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        )

        if (!response.ok) {
            const err = await response.text()
            console.error('[CAPTIONS] Generation request failed:', err)
            // If POST fails, try the alternative PUT method for "generating" which some docs refer to as just creating a placeholder
            // But let's return the error for debug first.
            return c.json({ error: 'Failed to trigger caption generation', details: err }, 502)
        }

        const data = await response.json()
        return c.json({ success: true, result: data })

    } catch (error) {
        console.error('[CAPTIONS] Error:', error)
        return c.json({ error: 'Internal error generating captions' }, 500)
    }
})

// Get video info from DailyMotion API (including actual duration)
app.get('/dm/:id', async (c) => {
    const dmId = c.req.param('id')

    console.log(`[DM] Fetching info for DailyMotion video ${dmId}`)

    try {
        const response = await fetch(
            `https://api.dailymotion.com/video/${dmId}?fields=id,title,duration,thumbnail_url,owner.username,created_time`
        )

        if (!response.ok) {
            return c.json({ error: 'Video not found on DailyMotion' }, 404)
        }

        const data = await response.json() as {
            id: string
            title: string
            duration: number
            thumbnail_url: string
            'owner.username': string
            created_time: number
        }

        console.log(`[DM] Video ${dmId}: duration=${data.duration}s, title="${data.title}"`)

        return c.json({
            id: data.id,
            title: data.title,
            duration: data.duration,
            thumbnail: data.thumbnail_url,
            owner: data['owner.username'],
            created: new Date(data.created_time * 1000).toISOString()
        })
    } catch (error) {
        console.error('[DM] Error:', error)
        return c.json({ error: 'Failed to fetch DailyMotion info' }, 500)
    }
})

// Create direct upload URL for browser-based upload (avoids 403 issues)
app.post('/upload/direct', async (c) => {
    // Auth check removed for public access

    try {
        const body = await c.req.json() as {
            maxDurationSeconds?: number
            meta?: Record<string, string>
        }

        console.log('[DIRECT] Creating direct upload URL...')

        // Create a direct upload URL via Cloudflare Stream API
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/stream/direct_upload`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${c.env.CLOUDFLARE_STREAM_API_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    maxDurationSeconds: body.maxDurationSeconds || 3600,
                    requireSignedURLs: false, // PUBLIC ACCESS
                    meta: body.meta || {}
                })
            }
        )

        if (!response.ok) {
            const errText = await response.text()
            console.error('[DIRECT] API error:', errText)
            return c.json({ error: 'Failed to create upload URL', details: errText }, 502)
        }

        const data = await response.json() as {
            result: {
                uid: string
                uploadURL: string
            }
        }

        console.log('[DIRECT] Upload URL created, UID:', data.result.uid)

        return c.json({
            success: true,
            uid: data.result.uid,
            uploadURL: data.result.uploadURL,
            message: 'Use this URL for direct browser upload'
        })

    } catch (error) {
        console.error('[DIRECT] Error:', error)
        return c.json({
            error: 'Failed to create direct upload URL',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500)
    }
})

// Admin/Migration: Ingest video from URL
app.post('/upload/url', async (c) => {
    // Auth check removed for public access

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
                requireSignedURLs: false
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
            // requiresignedurls false (base64: ZmFsc2U=)
            'Upload-Metadata': `requiresignedurls ZmFsc2U=, name ${btoa(body.meta?.dm_id || 'video')}`
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

    // Auth check removed for public access

    if (!c.env.OPENROUTER_API_KEY) {
        return c.json({ error: 'OpenRouter API key not configured' }, 500)
    }

    try {
        // First, get the video duration from Cloudflare Stream
        console.log(`[ANALYZE] Fetching video info for ${uid}...`)
        const streamUrl = `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}`

        const infoResponse = await fetch(streamUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${c.env.CLOUDFLARE_STREAM_API_TOKEN}`,
            }
        })

        let duration: number | undefined
        if (infoResponse.ok) {
            const info = await infoResponse.json() as { result: { duration?: number } }
            duration = info.result?.duration
            console.log(`[ANALYZE] Video duration: ${duration}s`)
        } else {
            console.warn(`[ANALYZE] Could not fetch video info, using default keyframe times`)
        }

        // Fetch captions (English) to include in analysis
        let captionsText: string | undefined
        try {
            console.log(`[ANALYZE] Fetching captions for ${uid}...`)
            const vttResponse = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}/captions/en`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${c.env.CLOUDFLARE_STREAM_API_TOKEN}`,
                        'Accept': 'text/vtt'
                    }
                }
            )

            if (vttResponse.ok) {
                const rawVtt = await vttResponse.text()
                const parsed = parseVTT(rawVtt)
                captionsText = parsed.csvText
                console.log(`[ANALYZE] Captions parsed to CSV, length: ${captionsText.length}`)
            } else {
                console.warn(`[ANALYZE] No captions found or fetch failed: ${vttResponse.status}`)
            }
        } catch (e) {
            console.warn(`[ANALYZE] Error fetching captions:`, e)
        }

        // Generate thumbnail URLs for the video based on duration
        const thumbnailUrls = generateThumbnailUrls(
            uid,
            c.env.CLOUDFLARE_ACCOUNT_ID,
            8,
            duration
        )

        console.log(`[ANALYZE] Analyzing video ${uid} with ${thumbnailUrls.length} keyframes`)
        console.log(`[ANALYZE] Validating each thumbnail URL...`)

        // Validate EACH thumbnail individually
        const validatedUrls: string[] = []
        for (const url of thumbnailUrls) {
            try {
                const head = await fetch(url, { method: 'HEAD' })
                if (head.ok) {
                    validatedUrls.push(url)
                    console.log(`[ANALYZE] ✓ ${url.split('?')[1]}`)
                } else {
                    console.log(`[ANALYZE] ✗ ${url.split('?')[1]} -> ${head.status}`)
                }
            } catch (e) {
                console.log(`[ANALYZE] ✗ ${url.split('?')[1]} -> Error`)
            }
        }

        if (validatedUrls.length === 0) {
            console.warn(`[ANALYZE] No thumbnails available! Aborting.`)
            return c.json({ error: 'No video thumbnails available', details: 'All thumbnail URLs returned errors' }, 422)
        }

        console.log(`[ANALYZE] ${validatedUrls.length}/${thumbnailUrls.length} thumbnails validated OK`)
        console.log(`[ANALYZE] Sending to AI:`, validatedUrls.map(u => u.split('?')[1]))

        // Call OpenRouter for analysis
        const analysis = await analyzeVideo(
            {
                videoId: uid,
                thumbnailUrls: validatedUrls,
                duration,
                captions: captionsText
            },
            c.env.OPENROUTER_API_KEY
        )

        // Update Cloudflare Stream metadata with AI Analysis
        let cfUpdateStatus = 'skipped'
        try {
            console.log(`[ANALYZE] Updating Cloudflare metadata for ${uid}...`)
            const updatePayload = {
                meta: {
                    name: analysis.result.title,
                    description: analysis.result.description,
                    tags: Array.isArray(analysis.result.tags) ? analysis.result.tags.join(',') : analysis.result.tags,
                    ai_generated: "true",
                    ai_confidence: analysis.result.confidence.toString()
                }
            }

            const updateResponse = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${c.env.CLOUDFLARE_STREAM_API_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(updatePayload)
                }
            )

            if (!updateResponse.ok) {
                const err = await updateResponse.text()
                console.warn(`[ANALYZE] Failed to update Cloudflare metadata: ${updateResponse.status} - ${err}`)
                cfUpdateStatus = `failed: ${updateResponse.status}`
            } else {
                console.log(`[ANALYZE] Cloudflare metadata updated successfully`)
                cfUpdateStatus = 'success'
            }

        } catch (updateError) {
            console.warn(`[ANALYZE] Error updating Cloudflare metadata:`, updateError)
            cfUpdateStatus = 'error'
        }

        return c.json({
            success: true,
            uid,
            duration,
            result: analysis.result,
            debug: analysis.debug,
            cfUpdateStatus
        })

    } catch (error) {
        console.error('Analysis error:', error)
        return c.json({ error: 'Analysis failed', details: error instanceof Error ? error.message : String(error) }, 500)
    }
})

// Proxy endpoint to get captions (VTT) for the client
app.get('/captions/:uid', async (c) => {
    const uid = c.req.param('uid')
    // Auth removed for public access

    try {
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/stream/${uid}/captions/en`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${c.env.CLOUDFLARE_STREAM_API_TOKEN}`,
                    'Accept': 'text/vtt'
                }
            }
        )

        if (!response.ok) {
            return c.json({ error: 'Failed to fetch captions', status: response.status }, 502)
        }

        const rawVtt = await response.text()
        const parsed = parseVTT(rawVtt)

        // Return structured data for client display
        return c.json({
            vtt: rawVtt,
            plainText: parsed.plainText,
            csv: parsed.csvText
        })

    } catch (error) {
        return c.json({ error: 'Internal server error fetching captions' }, 500)
    }
})


export default app
