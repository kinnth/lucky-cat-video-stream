/**
 * Cloudflare Stream Signed URL Service
 * Generates secure, time-limited tokens for private video playback
 */

interface SignedTokenOptions {
    videoId: string
    expiresInSeconds?: number
    downloadable?: boolean
    thumbnailTime?: number // Time in seconds for thumbnail
    customDomain?: string // Optional custom domain override
}

interface SignedUrlResult {
    playback_url: string
    thumbnail_url: string
    expires_at: string
    token: string
}

/**
 * Generate a signed token for Cloudflare Stream video playback.
 * Uses RS256 JWT signing with Cloudflare's signing key.
 */
export async function generateSignedUrl(
    options: SignedTokenOptions,
    env: {
        CLOUDFLARE_STREAM_SIGNING_KEY_ID: string
        CLOUDFLARE_STREAM_SIGNING_KEY_PEM: string
        CLOUDFLARE_ACCOUNT_ID: string
    }
): Promise<SignedUrlResult> {
    const { videoId, expiresInSeconds = 7200, downloadable = false, thumbnailTime, customDomain } = options

    // Calculate expiration time
    const now = Math.floor(Date.now() / 1000)
    const exp = now + expiresInSeconds

    // JWT Header
    const header = {
        alg: 'RS256',
        kid: env.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
    }

    // JWT Payload
    const payload: Record<string, unknown> = {
        sub: videoId,
        kid: env.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
        exp: exp,
        nbf: now - 60, // Allow 1 minute clock skew
    }

    // Add downloadable claim if enabled
    if (downloadable) {
        payload.downloadable = true
    }

    // Sign the JWT
    const token = await signJwt(header, payload, env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM)

    // Construct URLs - token replaces video ID in the URL
    // Use custom domain if provided, otherwise fallback to customer-{ACCOUNT_ID}
    const customerSubdomain = customDomain || `customer-${env.CLOUDFLARE_ACCOUNT_ID}.cloudflarestream.com`

    // Build thumbnail URL with optional time parameter
    let thumbnailUrl = `https://${customerSubdomain}/${token}/thumbnails/thumbnail.jpg`
    if (thumbnailTime !== undefined) {
        thumbnailUrl += `?time=${thumbnailTime}s&width=640`
    }

    return {
        playback_url: `https://${customerSubdomain}/${token}/manifest/video.m3u8`,
        thumbnail_url: thumbnailUrl,
        expires_at: new Date(exp * 1000).toISOString(),
        token,
    }
}

/**
 * Sign a JWT using RS256 algorithm
 */
async function signJwt(
    header: Record<string, string>,
    payload: Record<string, unknown>,
    pemKey: string
): Promise<string> {
    // Base64url encode header and payload
    const encodedHeader = base64UrlEncode(JSON.stringify(header))
    const encodedPayload = base64UrlEncode(JSON.stringify(payload))
    const signingInput = `${encodedHeader}.${encodedPayload}`

    // Import the PEM key
    const key = await importPemKey(pemKey)

    // Sign the input
    const signature = await crypto.subtle.sign(
        { name: 'RSASSA-PKCS1-v1_5' },
        key,
        new TextEncoder().encode(signingInput)
    )

    // Base64url encode the signature
    const encodedSignature = base64UrlEncode(
        String.fromCharCode(...new Uint8Array(signature))
    )

    return `${signingInput}.${encodedSignature}`
}

/**
 * Import a PEM-encoded RSA private key
 */
async function importPemKey(pem: string): Promise<CryptoKey> {
    // Remove PEM headers and decode
    const pemContents = pem
        .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
        .replace(/-----END RSA PRIVATE KEY-----/, '')
        .replace(/\s/g, '')

    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))

    return await crypto.subtle.importKey(
        'pkcs8',
        binaryKey,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    )
}

/**
 * Base64url encoding (URL-safe, no padding)
 */
function base64UrlEncode(str: string): string {
    const base64 = btoa(str)
    return base64
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}
