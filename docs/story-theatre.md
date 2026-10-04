# Story theatre

> Historical prototype: the current public demo does not ship this interface or expose its paid story endpoints.

The default page follows the large-character sketch: one central gnome, three story suggestions and a type/speak prompt, followed by a name question and the conversation transcript. The active speaker stays large; cast portraits choose the preferred person to question. Those portraits are renders of the existing rig and wardrobe.

## Story and voices

An authenticated, text-only ElevenLabs agent uses Gemini 3.8 Flash (with a 15-second cascade threshold for the longer structured output) and a `publish_story` client tool to create a complete script. Shared Zod validation requires 9–14 short turns, a maximum of 3,000 characters, all three speakers, distinct names and outfits, and the exact chosen hero name. The cast and script stay in the current browser session. A failed generation preserves the idea and name for retry; cancelling ends the planning session.

Each turn is voiced through ElevenLabs v3 Text to Dialogue with timestamps. The Worker pins Brian to Narrator, George to Hero and Liam to Friend. It streams bounded audio/timing responses; the browser prepares a complete short line and prefetches one following line. Character alignment and the existing pronunciation dictionary drive the mouth against the playback clock. Audio is generated rather than supplied from a recorded story library. Network and generation time can create a gap between lines.

The rig changes clothes, expression and optional gesture before a turn plays. One renderer is reused throughout, and clothing textures remain cached. Mute, reduced motion, Escape, page visibility and unmount cleanup apply to the story experience.

## Questions and resumption

Clicking the microphone pauses immediately and opens a signed WebSocket conversation with the characters agent. The microphone meter shows input activity. A cast selection sets the preferred speaker; an explicitly addressed name takes precedence. The `select_character` client tool applies the answering outfit before the agent uses that character’s configured multi-voice label.

The question agent receives the cast, already-heard turns and only the spoken fragment of the interrupted line. It is instructed to answer briefly without revealing the future plot. After audible playback finishes, a short follow-up window closes the question conversation and resumes the saved sentence boundary. This can repeat the beginning of the interrupted sentence, but does not replay the full story or duplicate transcript entries. **Continue story** provides a manual escape from a question session.

Typed questions use the same character agent in text-only mode. The returned answer is voiced as a short separate turn, then playback resumes. Typed mode does not open a microphone. The original free-chat agent and wardrobe tools remain available under **Just chat**.

## Server boundary

`/api/story/session` accepts only a fixed purpose (plan, setup or question), and returns a validated signed ElevenLabs WebSocket URL. `/api/story/speech` accepts only a fixed speaker and bounded text. Approved origins, rate limits (three session requests per purpose and 24 speech requests per IP per minute), request validation, provider timeouts and a two-megabyte response cap apply. The ElevenLabs API key stays in the Worker. Each agent has two concurrent calls, a 30-call daily limit, no paid bursting, a three-minute conversation limit and a 45-second silence cutoff. These limits are local-testing defaults; deployment still needs the production origins in both the Worker and agents.

The existing monorepo and separate Netlify/Workers deployment structure remain. The story agents are configured for local testing; this change does not publish the client or Worker.
