import { describe, expect, it } from 'vitest';
import { displayMessage } from '../apps/client/src/transcript';

describe('spoken transcript', () => {
  it('removes expressive delivery tags from the actual agent reply', () => {
    expect(
      displayMessage(
        'agent',
        '[cheerful] Hello there! It is [happy] lovely to meet you.',
      ),
    ).toBe('Hello there! It is lovely to meet you.');
  });
  it('removes the proud delivery tag observed in the live wardrobe reply', () => {
    expect(displayMessage('agent', '[proud] Ahoy!')).toBe('Ahoy!');
  });
  it('removes the brave delivery tag observed in a live story answer', () => {
    expect(displayMessage('agent', 'I am [brave] ready!')).toBe('I am ready!');
    expect(displayMessage('agent', '[warm] Hello! [gentle] Welcome.')).toBe(
      'Hello! Welcome.',
    );
  });
  it('preserves meaningful brackets and user text', () => {
    expect(displayMessage('agent', 'Try values[index] or [1, 2, 3].')).toBe(
      'Try values[index] or [1, 2, 3].',
    );
    expect(displayMessage('user', 'What does [happy] mean?')).toBe(
      'What does [happy] mean?',
    );
  });
  it('omits the synthetic user message from a silence timeout', () => {
    expect(displayMessage('user', '...')).toBeNull();
    expect(displayMessage('user', '…')).toBeNull();
    expect(displayMessage('user', 'Well... hello!')).toBe('Well... hello!');
  });
  it('does not render an empty delivery-only message', () => {
    expect(displayMessage('agent', '[whisper]')).toBeNull();
  });
});

it('removes a soft delivery directive observed in live character speech', () => {
  expect(displayMessage('agent', '[soft] Welcome back.')).toBe('Welcome back.');
});
