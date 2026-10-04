# Validation

Validated locally on 3 October 2026.

## Automated checks

- `npm run check`: workspace type checks, 72 tests and the production client build passed.
- `npm run format:check`: passed.
- `npm run worker:dry-run`: passed without deploying.
- The real local Workerd session endpoint accepts a bodyless POST and issues a validated ElevenLabs token when configured.

Tests additionally cover cue retention across pauses, new reply IDs, delayed old metadata, sustained loud fallback release at 30/60 FPS and silent held cues.

Tests cover approved origins, rate limiting, empty and nonempty request streams, upstream failures, bounded JSON, token validation, silence thresholds, time-based mouth smoothing, recorded cue playback, character alignment, pronunciation lookup, reconnect and interruption cleanup, expressive transcript cleanup and every animation on the actual exported character rig.

## Browser and live voice

- Chrome at 1200 × 960 and 390 × 844: character, recorded previews, gestures, controls and responsive layout checked.
- Live ElevenLabs WebRTC conversation: greeting audio played and generated mouth poses changed between open, rounded, puckered and consonant shapes. Character alignment was observed directly on the current WebRTC data channel, including chunk-relative timings.
- A scripted Web Audio input requested a wave. Scribe transcribed the request, the agent replied, and a new `perform_gesture` call advanced the wave sequence. Facial tool calls also reached the character. This did not record the user's physical microphone.
- A spoken request was also delivered while the greeting was playing; the agent responded to the request. A typed story prompt produced a live story reply. Switching from the live call to preview released the scripted microphone tracks.
- Microphone and output mute controls toggled during a real call. Ending with Escape returned the character to idle, closed its mouth and left all scripted microphone tracks ended.
- The server ended an idle test call after 45 seconds of silence; the completed conversation was confirmed through the API.
- Reduced-motion emulation and a synthetic visibility event exercised preview cleanup.
- Initial Axe WCAG 2 A/AA and 2.1 AA checks found no automatic violations in the checked preview, notice and voice-error states at desktop/mobile sizes. Automated checks do not establish full accessibility compliance.

A long-open-mouth regression was reproduced in a live greeting: a transient SDK listening callback cleared 44 queued cues, and the displayed wide pose held for 1.90 seconds. After retaining cues across pauses and adding a release envelope, a live greeting and story showed all nine poses with a longest observed wide hold of 0.19 seconds, with no fallback frames during their speaking phases. Ending the call released the scripted microphone tracks. All three recorded previews returned to rest; a 390 × 844 touch/coarse-pointer preview also returned to rest without horizontal overflow. These are observations from these local runs, not guarantees for every network or device.

The microphone input meter was checked in a live WebRTC call with scripted Web Audio input: silence returned a zero level, spoken input raised the bars while the gnome was speaking, and muting immediately flattened all five bars with the paused label. Unmuting resumed input feedback even with gnome output muted. A 390 × 844 layout with reduced motion had no horizontal overflow. Ending the call removed the meter and released all test input tracks. Physical microphone validation remains separate.

All nine mouth shapes were inspected on a stationary character at normal display size. A mobile Chrome context with touch/coarse pointer was checked at 390 × 844; the preview used timed articulation and had no horizontal overflow. The editable Spine project exported successfully with all images resolved.

Expressive TTS tags are removed from displayed agent messages, and silence-timeout ellipses are omitted from the user transcript. Three recorded ElevenLabs v3 preview clips replace the original system-voice placeholders.

LiveKit emitted signal-socket closure messages during teardown, while the interface returned to idle and media tracks were released. The calls were confirmed ended on ElevenLabs.

## Remaining validation

Physical microphones, real iOS Safari/Android Chrome, sustained-network failure recovery, precise barge-in timing and end-to-end latency measurements still need dedicated testing. The browser rendering caps are configured, but no measured frame-rate claim is made. The production build reports large vendor chunks for the voice and character runtimes; the character renderer loads separately.

Live phoneme timing is estimated inside aligned words using dictionary pronunciation; ElevenLabs provides character timing, not native phoneme or viseme events. Preview timing comes from offline analysis of the actual recordings. No claim of measured lip-sync error is made.

The initial validation above was local. The later production release is recorded below; physical-device checks listed here remain pending.

## Wardrobe validation

All 46 original pieces load in the real Spine parser with valid local atlas pages. All ten complete looks run through the included animation clips with finite bone coordinates and preserve the default speech attachment identities. Tests cover supported requests, optional removal, explicit keep, invalid item IDs, caching and failed-load retries. The editable 47-skin Spine project exports successfully, with all image paths resolved.

Chrome rendered all ten looks at desktop size. The 390 × 844 reduced-motion preview changed from pirate to dragon without horizontal overflow. New ElevenLabs hello and wardrobe recordings have 41 and 49 audio-derived cues respectively.

A live WebRTC call used `get_wardrobe`, then `change_outfit` with `look=pirate`. Scripted microphone speech requested gold sunglasses while keeping the rest of the outfit; the agent called `change_outfit` with `look=custom, glasses=gold_sunglasses`, the visible outfit updated, and the agent confirmed the change. ElevenLabs confirmed the conversation ended and all wardrobe tool results succeeded. The existing voice, LLM, authentication and conversation settings were preserved during the agent update.

A blocked clothing request retained the previous outfit pixel-for-pixel while loading and after cancellation. A simulated 503 also retained it; retrying the same piece successfully changed the visible outfit.

The first recorded introduction was checked immediately after reload: controls waited for the character to be ready, the pirate outfit appeared, the wardrobe greeting played, and no microphone stream was opened.

## Story theatre validation

The large stage, suggestion carousel, named-hero step, three-person cast, typed/voice questions and sentence-boundary resumption were checked in Chrome. Real personalized pirate and dragon stories were generated through the text-only planner and voiced through ElevenLabs Text to Dialogue. Brian, George and Lily are pinned to the three roles on the Worker. Cast outfits switch before a turn plays.

A typed question was answered as Stijn; a scripted microphone question was transcribed, answered and followed by automatic story resumption. Both scripted input tracks were ended after the question conversation closed. Selecting the companion produced an answer labelled Barnaby and a `Friend` speech request, then resumed the narrator. Voice story selection captured “The Friendly Dragon”; spoken naming captured “Pip” and started planning. Typed mode did not display microphone feedback or request microphone access.

Two planner attempts hit ElevenLabs’ LLM cascade timeout. The UI retained the selected idea/name for retry. The planner cascade threshold was increased from four to 15 seconds for its longer structured tool response; the subsequent dragon story succeeded. Character questions retain the shorter threshold. This observation does not establish provider reliability under every load.

At 390 × 844, the stage canvas measured 350 × 456 and the page had no horizontal overflow. At 1200 × 960, the stage and cast were checked visually. Contrast corrections and a keyboard-focusable scrollable transcript address the automatic accessibility findings. Subsequent Axe WCAG 2 A/AA and 2.1 AA checks reported no automatic violations at either viewport size. Mute controls and switching to Just chat and back were also checked; all six scripted setup microphone tracks were ended. Reduced-motion layout was checked. Physical microphones and real mobile browser playback remain in the dedicated-device validation list above.

New unit checks cover cast/script constraints, no future-turn disclosure, sentence-boundary replay, immediate pause, late audio cancellation, pausing between turns, disposal, planning cancellation/timeout during connection startup, all server-pinned voices, fixed agent selection, origin restrictions, quotas, provider errors, malformed timing and bounded audio streams. The fifth name-prompt recording has audio-derived cues.

## Character garden validation (2026-10-04)

The default variant now offers 18 named characters with distinct outfits, fictional backstories and 18 different premade ElevenLabs voice IDs verified against the account's voice catalog. Chrome rendered all 18 looks through the same persistent canvas. The original wardrobe pieces already covered the full Pebbler checkpoint-24 garment set; eight additional combinations extend the previous ten presets. All 19 original emotes and the job-complete celebration were imported into the standalone native project and runtime. Their facial beat profiles are active.

All equipped looks were posed across full clip durations with finite bone coordinates. Sampled bounds identified high/wide motions that needed extra space; authored envelopes now frame them without per-frame geometry measurement. The automated rig checks assert sampled gesture geometry fits desktop and 320/386 px mobile stages. Normal-motion Chrome previews exercised all 20 body actions; reduced-motion checks suppressed body motion and carousel sliding. The preview controls bring the stage into view before playing.

Real ElevenLabs typed replies used Pip's island backstory, and a full single-character story played with timestamped speech. Switching to Ember during audio stopped playback, showed a separate empty transcript, and returning to Pip restored his messages. A new session supplied Pip's own history: he correctly remembered the visitor name Alex. A microphone session introduced Ember; scripted input was transcribed and requested a wave. A follow-up sideflip request invoked the gesture client tool. Switching to Bramble ended the call, removed the input meter and left both test media tracks ended. The voice tool test honored the browser's reduced-motion preference; normal body-motion playback was checked separately through all preview controls. Physical microphones and all 18 voices have not been individually auditioned on real mobile devices.

The 320 and 390 px layouts showed no horizontal overflow, and the 390 × 844 prompt remained accessible below the character. Axe WCAG 2 A/AA and 2.1 AA scans found zero automatic violations in the checked desktop and mobile states, including expanded animation controls. This does not establish complete accessibility compliance.

The 81 unit tests, workspace type checks, production client build, Worker dry-run and formatting checks passed. Character endpoint tests cover catalog identities, bounded reconnect context, complete long-reply chunking, server-selected voices, origin restrictions, request limits, rate limits, safe signed-session destinations and provider error redaction. Vendor-chunk size warnings remain as documented above. No hosting deployment was performed.

### Three-character layout update

The character garden now uses short titles such as Pirate and Chef, with no personal names or dropdown picker. The centre character and two smaller neighbouring previews share one WebGL canvas and cached rig/garment assets. Arrows sit beneath the neighbouring previews. Browser checks traversed the full 18-character loop, checked previous/next titles and wraparound, and confirmed one canvas with no picker or horizontal overflow at 320/390 px widths. Reduced-motion navigation still works. All 81 tests, workspace type checks and the production build passed. Agent introductions and the saved character-agent configuration use title-only identities.

## Individual carousel transitions

The carousel moves the existing Spine instances between slots rather than transforming the whole canvas. Rightward navigation brings the left neighbour into the centre while the selected character moves right; reverse navigation follows the opposite path. The entering centre character grows and the outgoing centre character shrinks. Browser screenshots checked the intermediate and settled poses. The identity subtitle has been removed.

Chrome traversed the complete 18-character loop, including wraparound. At 320 and 390 px widths the page retained one canvas, no identity subtitle and no horizontal overflow. Reduced-motion navigation settled immediately. A live typed Ranger conversation after promotion used the Ranger identity, timed lip-sync and the wave client tool without an error; a local wave preview after a full loop also played on the active rig. All 84 unit tests, workspace type checks, production build and formatting checks passed. No hosting deployment was performed.

## Navigation, eye contact and male voices

The arrows now select the neighbour on the same side: right selects the right character and moves the rigs left, while left selects the left character and moves them right. The full 18-character loop and wraparound were checked in Chrome.

New preview rigs resolve world transforms before the face controller captures its neutral gaze and viewer axes. A real-rig regression test compares newly created and previously initialized characters in both skeleton orientations; it fails without the fix and passes with it. Screenshots of selected and neighbouring characters show forward gaze after carousel promotion.

All 18 garden characters now use 13 male stock voices, verified through ElevenLabs voice metadata; similar personalities share some voices. The seven previously female profiles now use male pronouns. Story theatre uses Liam for Friend in both timestamped narration and the existing live agent (updated and read back successfully). A live typed Dragon reply returned Charlie as its selected voice, played timestamped speech with seven sampled mouth poses, and showed no application alert. The 85 unit tests, workspace type checks and production build passed.

## Character About me introductions

All 18 male-voiced introductions were generated through ElevenLabs v3 with timestamps. The recordings last 14.88–21.6 seconds, totaling 5,231,960 MP3 bytes. Rhubarb analyzed their actual audio, producing 1,974 mouth cues; provider character alignment anchors 36 body gestures to scripted phrases. Clips and timing files load only after About me is clicked.

Chrome played all 18 correct MP3s with finite durations and no application alerts. A full Pirate run showed wave and awkward gestures at their aligned phrases, eight sampled mouth poses and automatic completion back to About me/rest. No live API requests occurred during that playback. Stop/replay and changing characters released media sources and closed AudioContexts. A failed timing request displayed a recoverable error, and retry succeeded. The 320 px mobile playback had no horizontal overflow; reduced motion kept the body idle. Axe WCAG 2 A/AA and 2.1 AA scans at 1200 and 320 px found zero automatic violations. This does not establish full accessibility compliance or physical-device playback validation.

All 89 tests, workspace type checks, production build and final formatting checks passed. Tests validate every character's audio/timing assets and voice identity, reject invalid choreography, keep gestures tied to media time during buffering and avoid a backlog after skipped playback updates. No hosting deployment was performed.

## Recorded audio completion

The About me cutoff was traced to immediate AudioContext closure in the media-ended callback. Royal's MP3 decodes cleanly and has speech energy through its last frame. In the local browser, natural completion occurred with about 221 ms still pending at the output device; the old cleanup closed the graph within 1 ms. The player now waits for reported/observed output latency plus a 50 ms scheduling margin, with a conservative fallback for older implementations and a bounded delay. Royal's revised ending closed after about 273 ms, preserving the pending output. The recordings were not regenerated.

Regression tests cover keeping the output connected during the final queued samples, immediate explicit Stop/dispose, cancellation of a pending completion callback, duplicate-ended events and missing/invalid latency reports. All 94 tests, workspace type checks, the production build and formatting checks passed.

## v4 Turbo migration — 4 October 2026

The character agent was patched to `eleven_v4_turbo` and read back from ElevenLabs; its other conversation settings were preserved and a temporary backup was saved before the update. On-demand typed speech and future introduction generation use the same model. Existing prerecorded introductions were not regenerated. A direct timestamped speech request returned eight audio packets with alignment. A real typed reply through the local Worker played with timed mouth movements and no UI alert. A real live agent greeting was tested with a synthetic silent microphone (no user microphone captured), returning audio packets with timed mouth movements and no UI alert. All 94 tests, workspace typechecks, formatting checks and the production build passed. A stray `T` in the existing story test fixture was removed to restore parsing.

## Public-demo access and cost controls (2026-10-04)

- Server-validated Turnstile checks success, hostname and action; missing/expired/replayed checks cannot mint a visitor capability. Loopback development is an explicit environment/URL/origin exception.
- HMAC-signed visitor capabilities are verified before Durable Object lookup. Forged credentials cannot allocate arbitrary visitor objects; the store enforces expiry/origin and preserves request replay records.
- Real Miniflare/workerd SQLite tests pass for parallel final-budget claims, duplicate requests, per-session/global concurrency, day/network limits and persistence across a runtime restart.
- Unit tests cover fail-closed missing credentials/stores, kill switches, removed legacy endpoints, bounded JSON/audio, provider redirects without forwarding keys, cancellation and friendly client retries.
- The existing ElevenLabs character agent was backed up, patched and read back successfully: signed URL authentication, 180-second duration, two concurrent calls, 60/day, bursting off, v4 Turbo and restricted overrides.
- Browser validation used Cloudflare's published test widget key in an isolated local browser; the real widget completed, the production test-key refusal remained enabled, and a real typed reply played through the capability-protected session and timestamped speech endpoints. This does not replace testing a real production widget/secret on tesselpunt.com.
- Browser testing also exercised a simulated exhausted allowance and confirmed recorded introductions remain available. Test intercepts were removed afterwards.
- Production hosting/DNS, Turnstile widget credentials and portfolio integration have not been deployed by this change. See anti-abuse.md for the explicit limitations of direct browser-to-provider signed URLs.

## Initial release preparation

All 111 tests in 17 files, workspace type checks, client/types builds, formatting and the production Worker dry run pass. The shared package tarball contains bundled ESM, a self-contained declaration file, README and metadata. An isolated Node ESM consumer and a strict TypeScript NodeNext consumer both pass; the check verifies that outfit IDs remain a literal union. The local Git release was scanned against the actual local provider key and for ignored secret/state files and oversized assets.

The portfolio snapshot builds under `/interactive/voiced-gnome/`. Its 30 prerendered routes and build checks pass, with no initial iframes or eager demo code. Browser checks confirm explicit iframe loading, recorded Pirate introduction playback, Stop removing the iframe, and character switching at a 390px viewport. The final API domain is not yet deployed, so the integration currently shows the expected live-unavailable fallback. Real production Turnstile, response-header and microphone checks remain pending deployment. The existing live agent passes the read-only security check.

No production Turnstile widget, Worker secret, custom domain deployment, GitHub push/package publication or portfolio deployment was performed during this preparation.
