# Character implementation

`assets/gnome/gnome.spine` is the separate editable Spine 4.3 project. The original Pebbler source is not modified. All 46 wardrobe pieces, original animations and generated mouth attachments are local under `assets/gnome/images`. Image filenames without `_0` are aliases for the originals unpacked from indexed atlas regions, so the native editor can resolve the region paths correctly.

`apps/client/public/gnome` holds the runtime JSON and atlases. It uses the pinned matching Spine 4.3 runtime. The separate `gnome-mouths.png` atlas is about 168 kB and uses premultiplied alpha; the original outfit atlases remain independent.

## Wardrobe

The catalog provides 45 selectable pieces in five categories, plus the fixed white beard: ten headwear items, three glasses, fourteen shirts, ten pants and eight footwear items. Eighteen complete looks are available, alongside arbitrary supported combinations. Only headwear and glasses can be removed. A custom request keeps unspecified pieces; explicit `keep` retains the current piece even when selecting a complete look.

Each extra garment has a separate JSON/atlas under `public/gnome/wardrobe`. The loader validates the rig's bone and slot ordering, resolves required gaze slider clips, remaps skin bone/constraint/clipping references, and adds garments to a composite skin without replacing default face and mouth attachments. Cached pieces are reused. All requested pieces load before applying a change. Cancellation, disconnect and newer requests prevent an older pending outfit from being applied. A failed load leaves the visible outfit in place and can be retried.

In the original **Just chat** variant, ElevenLabs `get_wardrobe` returns the current outfit and available choices. `change_outfit` accepts a named look or supported individual item IDs, applies the change, and returns the actual resulting outfit. The prompt waits for success before claiming a change. Successful changes trigger a bow; reduced motion suppresses the gesture. The default outfit loads on initial page entry. A visual hint and conversation starter make the feature discoverable; the first recorded introduction demonstrates a change only after a user click.

The face controller resolves the initial world transforms before capturing the neutral gaze and viewer axes. This includes newly created carousel neighbours, which have not ticked yet, and keeps their gaze facing the visitor when promoted to the centre.

## Speech and expression

The `voice_mouth` slot attaches to `mouth_base`. Nine named attachments match Rhubarb's visual categories:

| Cue | Attachment     | Use                   |
| --- | -------------- | --------------------- |
| X   | speech_rest    | Relaxed smile / pause |
| A   | speech_pressed | P, B, M               |
| B   | speech_teeth   | Consonants / ee       |
| C   | speech_mid     | eh / ae               |
| D   | speech_wide    | ah                    |
| E   | speech_round   | Rounded vowel         |
| F   | speech_pucker  | oo / W                |
| G   | speech_fv      | F / V                 |
| H   | speech_tongue  | L                     |

The artwork was created using the built-in image-generation tool with the original mouth textures as style references. The selected sheet, a separately refined F/V mouth, unpack metadata and prompts are in `assets/gnome/mouth-reference`. Spine's native unpacker and packer converted them to source attachments and the runtime atlas; no new renderer or machine-learning inference runs in the browser. Mouth size and proportions are set in the rig, including a restrained horizontal pucker. Open poses share an upper-lip anchor, allowing the jaw to move downward rather than moving the entire mouth.

During speech, mouth attachments replace the original expression mouth slots. At rest, neutral/happy expressions use the gentle generated smile, while curious, proud and surprised expressions regain their original mouths. Cheeks, brows, eyes, blinks and body animation remain independent.

### Recorded preview

Rhubarb 1.14.0 analyzed the actual shipped MP3 recordings, converted locally to mono 16 kHz WAV with FFmpeg, with the dialogue supplied as a recognition hint. The browser loads only the resulting JSON cues (41 / 36 / 38 / 49 for hello / wave / story / wardrobe). Cues follow `HTMLAudioElement.currentTime`, with 25 ms anticipation. They remain synchronized after seeking, replay or tab cleanup. Cue failure falls back to the audio analyser.

To regenerate, install Rhubarb and FFmpeg locally, set `RHUBARB_PATH` and optionally `FFMPEG_PATH` if needed, then run `npm run preview:cues`. These are offline development tools and are not dependencies of the shipped browser app.

### Live conversation

The current ElevenLabs WebRTC connection sends alignment alongside live audio. The client listens to incoming audio metadata and queues its character timings. The live clock starts when output audio becomes audible rather than when network metadata arrives. CMUdict pronunciation is converted to the visual groups, then distributed within each aligned word. This is an estimate of phoneme timing, not native timestamped phonemes. Unknown words use small English spelling rules. Delivery tags are excluded.

The 124,804-word visual pronunciation table loads only when starting live mode; it is approximately 2.35 MB JSON / 566 kB gzip. No large speech recognizer runs on desktop or mobile. Rebuild the derived table from Rhubarb’s `res/sphinx/cmudict-en-us.dict` with `node scripts/build-viseme-dictionary.mjs /path/to/cmudict-en-us.dict`; keep the distributed license. Silence rests the mouth. Alignment chunks are grouped by their reply event ID; the next reply, interruption, end and unmount clear the queue. Temporary WebRTC listening modes during a pause retain the current reply’s cues and playback origin. Delayed metadata from an older reply is ignored. Missing alignment uses amplitude-driven openness with hysteresis. Audio mute rests the mouth.

Both timed and fallback articulation relax the largest open pose to the medium mouth after a 220 ms attack, preserving consonant and rounded-vowel shapes. Low audio energy narrows that pose immediately, and 75 ms of silence at the analyser input rests any held cue. A new articulation or audible syllable rearms the open accent. These are animation release settings, not measured audio-to-display latency.

## Microphone feedback

A compact five-bar input meter appears beside the microphone toggle during a connected call. It samples `getInputVolume()` from the SDK-owned input stream independently of the gnome's speaking mode, so feedback remains available while interrupting the gnome. The smoothed relative level updates directly in the DOM at up to 30 FPS; the screen-reader meter value is refreshed at up to 5 Hz without live announcements. It adds no microphone stream or recording.

Quiet input settles the bars near the baseline. Pausing input immediately flattens them, labels the state “Microphone paused” and stops sampling until unmuted. Ending the call removes the meter and cancels its animation frame. Functional level feedback remains available with reduced motion. The bars indicate locally captured audio; recognition is confirmed separately by the transcript.

## Gaze, rendering and lifecycle

The body uses track 0, expression track 1 and blink track 2. The face controller calibrates lid geometry once and bounds pupils within the current expression's lids. Gaze looks toward the user while idle, listening and speaking, with a small upward glance while thinking and a smoothed return to eye contact. Pointer movement does not control the eyes.

One WebGL canvas renders the character. Desktop is capped at 60 FPS, coarse-pointer devices at 30 FPS; resolution is capped at 2 and 1.5 respectively. A fixed authored envelope avoids per-frame bounds sampling. Animation does not update React state. Fonts are self-hosted; recorded audio and cues load only when played.

Reduced motion suppresses body emotes, ambient blinks, thinking glances and head movement while retaining speech articulation. Hidden tabs stop the renderer and end audio/conversations. Unmount releases the canvas, observers, cue requests and audio resources. The ElevenLabs SDK owns the microphone stream.

## Editing

Open `assets/gnome/gnome.spine` in Spine 4.3.26 and select the demo outfit skins. The `mouths/*` clips let you inspect each speech attachment. Preserve the nine `speech_*` attachment names or update `MOUTH_POSES` and the cue mappings together. Export to a temporary directory and verify before replacing runtime assets. Runtime speech selects attachments directly; it does not play the inspection clips.

Draw-order timelines from the original export were omitted when the new slot was inserted, avoiding offsets for the previous slot list. Author new draw-order changes on this standalone project.

Run `npm run check`, then inspect speech, expressions and gestures on desktop and mobile. Tests parse the real JSON/atlas, validate all preview cues and check playback clocks, invalid timing, pronunciation, silence and interruption.

## Full emote set and character garden

The standalone native project now includes every checkpoint-24 emote (19) and the job-complete celebration. Spine 4.3 native animation import remapped timelines, including draw-order offsets, around the added speech slot. The runtime JSON keeps its base skins and loads wardrobe skins separately. Source Pebbler projects remain unchanged.

The Pebbler facial beat profiles accompany body clips: expressions, brows, pupils and purposeful gaze changes make motions such as buffering, awkwardness and celebration readable. Speech articulation temporarily takes precedence over the expression mouth; facial channels remain independent. Reduced motion suppresses body emotes and carousel sliding.

All 18 outfits were sampled across full clip durations to build authored motion envelopes. The renderer uses these fixed envelopes to give high jumps and wide gestures enough room, smoothing the framing change and restoring the large resting size afterwards. It avoids per-frame geometry bounds calculation. Gesture previews remain available offline in a collapsible panel, and the live agent can invoke the same validated emote IDs.
