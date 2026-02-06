const WORKER_URL = 'https://lucky-cat-video-stream.kinnth.workers.dev';
const LUCKYCAT_API = 'https://api-devel.luckycat.me';
const id = 'x9zbleo';

async function test() {
    console.log('Testing DM fetch...');
    try {
        const r1 = await fetch(`${WORKER_URL}/dm/${id}`);
        console.log('DM Fetch status:', r1.status);
        if (r1.ok) {
            console.log('DM Data:', await r1.json());
        }
    } catch (e) { console.error('DM Fetch failed:', e); }

    console.log('Testing API fetch...');
    try {
        const r2 = await fetch(`${LUCKYCAT_API}/video/playback_source_by_dm_id/${id}`);
        console.log('API Fetch status:', r2.status);
        if (r2.ok) {
            console.log('API Data:', await r2.json());
        } else {
            console.log('API Error:', await r2.text());
        }
    } catch (e) { console.error('API Fetch failed:', e); }
}
test();
