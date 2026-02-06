import { Context, Next } from 'hono'

export interface NakamaUser {
    user_id: string
    username: string
}

interface NakamaSessionResponse {
    id: string
    username: string
    vars?: Record<string, string>
}

/**
 * Middleware to validate Nakama session tokens.
 * Attaches user info to Hono context if valid.
 */
export async function nakamaAuth(c: Context, next: Next) {
    const authHeader = c.req.header('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Missing or invalid Authorization header' }, 401)
    }

    const token = authHeader.substring(7)
    const nakamaUrl = c.env.NAKAMA_URL as string

    try {
        // Validate session with Nakama
        const response = await fetch(`${nakamaUrl}/v2/account`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        })

        if (!response.ok) {
            return c.json({ error: 'Invalid or expired session' }, 401)
        }

        const data = await response.json() as { user: NakamaSessionResponse }

        // Attach user to context
        c.set('user', {
            user_id: data.user.id,
            username: data.user.username,
        } as NakamaUser)

        await next()
    } catch (error) {
        console.error('Nakama auth error:', error)
        return c.json({ error: 'Authentication failed' }, 500)
    }
}

/**
 * Helper to get authenticated user from context
 */
export function getUser(c: Context): NakamaUser {
    return c.get('user') as NakamaUser
}
