/**
 * Simple parser for WebVTT captions
 */
export interface CaptionSegment {
    start: string
    end: string
    text: string
}

/**
 * Parses raw VTT text into structured segments and plain text
 */
export function parseVTT(vttText: string): { segments: CaptionSegment[], plainText: string, csvText: string } {
    const segments: CaptionSegment[] = []

    // Split by double newline to get blocks
    const blocks = vttText.split(/\r?\n\r?\n/)

    for (const block of blocks) {
        // Skip header
        if (block.includes('WEBVTT')) continue

        const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        if (lines.length < 2) continue

        // Find line with --> (timestamps)
        const timeLineIndex = lines.findIndex(l => l.includes('-->'))
        if (timeLineIndex === -1) continue

        const [start, end] = lines[timeLineIndex].split('-->').map(s => s.trim())
        const text = lines.slice(timeLineIndex + 1).join(' ')

        if (start && end && text) {
            segments.push({ start, end, text })
        }
    }

    // Create a plain text version for humans/AI
    const plainText = segments.map(s => `[${s.start}] ${s.text}`).join('\n')

    // Create CSV version with title header
    // Format: "Audio Captions and Timestamps Reference for Video"
    // Each line: Start, End, "Text"
    const csvTitle = 'Audio Captions and Timestamps Reference for Video\n'
    const csvHeader = 'Start Time, End Time, Caption Text\n'
    const csvRows = segments.map(s => {
        // Escape quotes by doubling them
        const text = s.text.replace(/"/g, '""')
        return `${s.start}, ${s.end}, "${text}"`
    }).join('\n')

    // Add video duration info if we can calculate it
    let durationNote = ''
    if (segments.length > 0) {
        const lastSegment = segments[segments.length - 1]
        durationNote = `\n\n--- Total segments: ${segments.length}, Last timestamp: ${lastSegment.end} ---`
    }

    const csvText = csvTitle + csvHeader + csvRows + durationNote

    return { segments, plainText, csvText }
}
