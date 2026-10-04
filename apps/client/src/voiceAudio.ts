import rawAudioProcessor from '@elevenlabs/client/worklets/rawAudioProcessor.js?url&no-inline';
import audioConcatProcessor from '@elevenlabs/client/worklets/audioConcatProcessor.js?url&no-inline';
import libsampleratePath from '@alexanderolsen/libsamplerate-js/dist/libsamplerate.worklet.js?url&no-inline';

// Vite emits real same-origin files, including the optional mobile resampler.
// Worklets follow script-src, so blob/data URLs would violate our CSP.
export const voiceAudioOptions = {
  workletPaths: { rawAudioProcessor, audioConcatProcessor },
  libsampleratePath,
};
