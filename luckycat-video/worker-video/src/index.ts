import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { nakamaAuth, getUser } from './middleware/nakama-auth'
import { generateSignedUrl } from './services/stream-signed-url'

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

// Admin: Ingest video from URL (for migration)
app.post('/upload/url', async (c) => {
    // TODO: Add admin auth check
    // TODO: Call Cloudflare Stream API
    return c.json({
        message: 'URL ingestion endpoint - implementation pending (Phase 3)'
    })
})

// Cloudflare Stream webhook handler
app.post('/webhook', async (c) => {
    // TODO: Verify webhook signature
    // TODO: Handle video.ready and video.captioned events
    return c.json({
        received: true,
        message: 'Webhook handler - implementation pending (Phase 3)'
    })
})

export default app
