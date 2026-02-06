# LuckyCat Video Implementation Plan

## Phase 1: Basic Upload & Playback [COMPLETED]
- [x] **Worker Setup**: Initialize Hono worker with Cloudflare stream bindings.
- [x] **Direct Upload**: Implement `/upload/direct` for browser-based TUS uploads.
- [x] **URL Upload**: Implement `/upload/url` for importing videos by URL.
- [x] **Status Polling**: Implement `/status/:uid` to track encoding progress.
- [x] **Public Access**: Configure `requireSignedURLs: false` and remove Auth checks for testing.

## Phase 2: AI Captions & Analysis [COMPLETED]
- [x] **Caption Trigger**: Implement `/captions/generate/:uid` to start Cloudflare AI captioning.
- [x] **Caption Polling**: Update Client to poll for caption completion.
- [x] **Fetch VTT**: Implement `/captions/:uid` proxy endpoint to retrieve raw VTT.
- [x] **Display Captions**: Add "Generated Captions" panel to Client UI.
- [x] **AI Analysis**: Integrate OpenRouter (Gemini Flash) for video analysis.
- [x] **Debug Info**: Return system prompts, user prompts, and screenshots for verification.
- [x] **UX Improvements**: Enable "Analyze" button immediately (async captions).

## Phase 3: Metadata Sync & Finalization [COMPLETED]
- [x] **Update Cloudflare Metadata**: Save the generated AI Title, Description, and Tags back to the Cloudflare Stream video object.
- [x] **VTT Caption Parsing (**CSV**)**: Implemented a parser to convert VTT to CSV (Start,End,Text) for AI analysis, while keeping a readable format for the UI.
- [x] **Refine AI Prompt**: Implemented conversational prompt using 8 keyframes and CSV captions.
- [x] **Public Access Fix**: Set `requireSignedURLs: false` for all upload methods to ensure OpenRouter can access thumbnails.
- [ ] **JSON Structure Verification**: Ensure the metadata matches any specific external requirements.
- [ ] **Cleanup**: Remove debug logs once final user verification is done.


## Phase 4: AI Testing
- [ ] create a VTT -> CSV parser, store the CSV file somewhere.
- [ ] ensure the system uploads all 8 images, and csv transcript of the captions.
- [ ] perfect the prompt for the ai so that it gives well descriptive, keyword heavy description.
- [ ] also give a score of inappropriateness, if nudity, violence or IP infrigement occurs.
- [ ] Save everything in a json associated with the file.
- [ ] organise into a group level such as #fruit #animals #family etc.

## Phase 5: Error Resilience (Test Viewer) [IN PROGRESS]
- [ ] **Load Video**: Add timeouts, validation, and improved UI feedback.
- [ ] **Upload**: Handle interruptions and pre-validate inputs.
- [ ] **Polling**: Implement backoff and max-retries.
- [ ] **AI Analysis**: Handle API failures and missing data dependencies gracefully.


