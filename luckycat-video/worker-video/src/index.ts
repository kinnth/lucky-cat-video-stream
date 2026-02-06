import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { nakamaAuth, getUser } from './middleware/nakama-auth'

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

    // TODO: Validate user owns video
    // TODO: Generate signed URL

    return c.json({
        video_id: videoId,
        user_id: user.user_id,
        playback_url: null,
        expires_at: null,
        message: 'Signed URL endpoint - implementation pending (Phase 2)'
    })
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
