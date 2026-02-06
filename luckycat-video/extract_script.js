const fs = require('fs');
const html = fs.readFileSync('c:/Users/Tom/Documents/Antigravity/luckycat-video/test-viewer/index.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/g);
if (scriptMatch) {
    // Take the last one which is the big logic block
    const script = scriptMatch[scriptMatch.length - 1].replace('<script>', '').replace('</script>', '');
    fs.writeFileSync('extracted_script.js', script);
    console.log('Script extracted.');
} else {
    console.log('No script found.');
}
