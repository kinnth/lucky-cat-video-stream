import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
    return c.text('LuckyCat Video API')
})

// POST /upload/direct - Generate TUS upload URL
app.post('/upload/direct', (c) => {
    return c.json({ message: 'TUS upload endpoint placeholder' })
})

// POST /upload/url - Ingest via URL
app.post('/upload/url', (c) => {
    return c.json({ message: 'URL ingestion endpoint placeholder' })
})

// POST /webhook - CF Stream Webhook
app.post('/webhook', (c) => {
    return c.json({ message: 'Webhook handler placeholder' })
})

export default app
