// Expressive TTS directives are delivery instructions, not spoken words.
const deliveryTag =
  /^(?:quiet|calm|soft|softly|gentle|gently|warm|warmly|playful|cheerful|happy|happily|excited|curious|proud|brave|sad|angry|thoughtful|thoughtfully|sarcastic|mischievous|mischievously|whisper(?:s|ing)?|shout(?:s|ing)?|laugh(?:s|ing)?|chuckle(?:s|ing)?|sigh(?:s|ing)?|exhale(?:s|ing)?|crying|snorts|wheezing)(?:\s|$)/i;

export function displayMessage(
  role: 'user' | 'agent',
  message: string,
): string | null {
  if (role === 'user') {
    // ElevenLabs emits an ellipsis for a silence timeout; nobody said this.
    return /^(?:\.{3}|…)\s*$/.test(message.trim()) ? null : message;
  }
  const text = message
    .replace(/\[([^\[\]\n]+)\]/g, (original, tag: string) =>
      deliveryTag.test(tag.trim()) ? '' : original,
    )
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return text || null;
}
