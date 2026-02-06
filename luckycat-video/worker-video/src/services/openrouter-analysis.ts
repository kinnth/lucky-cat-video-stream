/**
 * OpenRouter AI Analysis Service
 * Analyzes video keyframes and captions to generate metadata
 */

interface AnalysisRequest {
    videoId: string
    thumbnailUrls: string[]
    captions?: string
    duration?: number
}

interface AnalysisResult {
    title: string
    description: string
    category: string
    tags: string[]
    content_rating: 'safe' | 'sensitive' | 'explicit'
    language: string
    mood: string
    confidence: number
}

export interface AnalysisResponse {
    result: AnalysisResult
    debug: {
        systemPrompt: string
        userPrompt: string
        screenshots: string[]
        transcription?: string
    }
}

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Analyze video using OpenRouter with vision-capable model
 */
export async function analyzeVideo(
    request: AnalysisRequest,
    apiKey: string
): Promise<AnalysisResponse> {

    // Build the prompt with keyframes
    const imageContent = request.thumbnailUrls.slice(0, 8).map(url => ({
        type: 'image_url' as const,
        image_url: { url }
    }))

    const systemPrompt = `You are a video content analyzer. Analyze the provided video keyframes and any available captions to generate accurate metadata.

Output JSON with these exact fields:
{
  "title": "A catchy title based on the content (max 60 chars). Can use an emoji if appropriate.",
  "description": "A detailed description of what the video is about (100-200 words).",
  "category": "One of: Entertainment, Education, Gaming, Music, Sports, News, Cooking, Travel, Technology, Fashion, Fitness, Art, Comedy, Documentary, Kids",
  "tags": ["array", "of", "exactly", "5", "searchable", "tags"],
  "content_rating": "safe" | "sensitive" | "explicit",
  "language": "ISO 639-1 code (e.g., en, es, fr)",
  "mood": "One of: Happy, Calm, Energetic, Serious, Funny, Inspiring, Dramatic, Relaxing",
  "confidence": 0.0-1.0 (how confident you are in this analysis)
}

Be accurate and descriptive. Focus on what's actually visible in the frames.`

    const userPrompt = `Can you please look at these ${request.thumbnailUrls.length} pictures and then describe what this video is about? It is ${request.duration ? Math.round(request.duration) : 'unknown'} number of seconds, and this is the captions from that video in CSV format (Start,End,Text):
${request.captions ? `\n${request.captions}` : '(No captions available)'}

Please provide your analysis in the metadata JSON format requested. Be extremely detailed and use lots of relevant keywords in the description.`

    const messages = [
        { role: 'system', content: systemPrompt },
        {
            role: 'user',
            content: [
                { type: 'text', text: userPrompt },
                ...imageContent
            ]
        }
    ]

    const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://luckycat.me',
            'X-Title': 'LuckyCat Video Analyzer'
        },
        body: JSON.stringify({
            model: 'google/gemini-2.0-flash-001',
            messages,
            max_tokens: 1000,
            temperature: 0.3,
            response_format: { type: 'json_object' }
        })
    })

    if (!response.ok) {
        const errorText = await response.text()
        console.error('OpenRouter API error:', errorText)
        throw new Error(`OpenRouter API failed (400): ${errorText}`)
    }

    const data = await response.json() as {
        choices: Array<{
            message: {
                content: string
            }
        }>
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
        throw new Error('No content in OpenRouter response')
    }

    // Clean content (remove markdown fences if present)
    const cleanedContent = content.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim()

    try {
        const result = JSON.parse(cleanedContent) as AnalysisResult
        return {
            result,
            debug: {
                systemPrompt,
                userPrompt,
                screenshots: request.thumbnailUrls.slice(0, 8),
                transcription: request.captions
            }
        }
    } catch (parseError) {
        console.error('Failed to parse OpenRouter response. Raw:', content, 'Cleaned:', cleanedContent)
        throw new Error(`Invalid JSON in OpenRouter response: ${cleanedContent.substring(0, 50)}...`)
    }
}

/**
 * Generate thumbnail URLs for a Cloudflare Stream video
 * Times are calculated based on video duration for even distribution
 * IMPORTANT: Timestamps must not exceed (duration - 0.1) or Cloudflare returns 400
 */
export function generateThumbnailUrls(
    streamUid: string,
    accountId: string,
    count: number = 8,
    duration?: number
): string[] {
    // Use standard videodelivery.net domain which is often more reliable for fresh uploads
    const baseUrl = `https://videodelivery.net/${streamUid}/thumbnails/thumbnail.jpg`

    let times: number[]

    if (!duration || duration <= 0) {
        // Fallback to default times if no duration
        times = [1, 5, 10, 20, 30, 45, 60, 90].slice(0, count)
    } else {
        // Calculate max safe time (slightly before end to avoid 400 errors)
        const maxTime = Math.max(0, duration - 0.5)

        if (duration <= 10) {
            // Very short video: spread evenly with smaller intervals
            times = Array.from({ length: count }, (_, i) => {
                const t = (maxTime * i) / (count - 1)
                return Math.max(0.1, Number(t.toFixed(1)))
            })
        } else if (duration <= 60) {
            // Short video (under 1 min): evenly distributed
            times = Array.from({ length: count }, (_, i) => {
                const t = (maxTime * i) / (count - 1)
                return Math.floor(t)
            })
        } else {
            // Longer video: use percentage-based distribution
            const percentages = [0.02, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95]
            times = percentages.slice(0, count).map(p => Math.floor(duration * p))
        }

        // Ensure first frame is at least 0.1s and last frame doesn't exceed maxTime
        times[0] = Math.max(0.1, times[0])
        times[times.length - 1] = Math.min(times[times.length - 1], Math.floor(maxTime))
    }

    console.log(`[KEYFRAMES] Generated times for ${duration}s video (max safe: ${duration ? duration - 0.5 : 'N/A'}):`, times)

    return times.map(t => `${baseUrl}?time=${t}s&width=640`)
}
