import { z } from 'zod';
export const EMOTES = {
  wave: {
    animation: 'animations/emotes/overeager_hello',
    label: 'Hello there',
    expression: 'happy',
  },
  celebrate: {
    animation: 'animations/emotes/happy_hop',
    label: 'Happy hop',
    expression: 'happy',
  },
  bow: {
    animation: 'animations/emotes/very_important_bow',
    label: 'Very important bow',
    expression: 'proud',
  },
  shrug: {
    animation: 'animations/emotes/who_me',
    label: 'Who, me?',
    expression: 'curious',
  },
  dance: {
    animation: 'animations/emotes/pebbler_groove',
    label: 'Garden groove',
    expression: 'happy',
  },
  awkward: {
    animation: 'animations/emotes/awkward',
    label: 'Awkward moment',
    expression: 'curious',
  },
  balance_panic: {
    animation: 'animations/emotes/balance_panic',
    label: 'Balance panic',
    expression: 'surprised',
  },
  buffering_bot: {
    animation: 'animations/emotes/buffering_bot',
    label: 'Buffering bot',
    expression: 'curious',
  },
  disco: {
    animation: 'animations/emotes/disco_gnome',
    label: 'Disco gnome',
    expression: 'happy',
  },
  heel_click: {
    animation: 'animations/emotes/heel_click_hooray',
    label: 'Heel-click hooray',
    expression: 'happy',
  },
  show_prize: {
    animation: 'animations/emotes/look_what_i_earned',
    label: 'Look what I found',
    expression: 'proud',
  },
  mastered_it: {
    animation: 'animations/emotes/mastered_it',
    label: 'Mastered it',
    expression: 'proud',
  },
  promotion: {
    animation: 'animations/emotes/me_promoted',
    label: 'Me, promoted?',
    expression: 'surprised',
  },
  nailed_it: {
    animation: 'animations/emotes/nailed_it',
    label: 'Nailed it',
    expression: 'proud',
  },
  onwards: {
    animation: 'animations/emotes/onwards',
    label: 'Onwards',
    expression: 'proud',
  },
  sideflip: {
    animation: 'animations/emotes/sideflip_jump',
    label: 'Sideflip jump',
    expression: 'surprised',
  },
  ta_da: {
    animation: 'animations/emotes/ta_da',
    label: 'Ta-da!',
    expression: 'happy',
  },
  tantrum: {
    animation: 'animations/emotes/tiny_tantrum',
    label: 'Tiny tantrum',
    expression: 'surprised',
  },
  victory_pump: {
    animation: 'animations/emotes/victory_pump',
    label: 'Victory pump',
    expression: 'proud',
  },
  grand_celebration: {
    animation: 'animations/job_complete/job_complete',
    label: 'Grand celebration',
    expression: 'happy',
  },
} as const;
export const GestureSchema = z.enum(
  Object.keys(EMOTES) as [keyof typeof EMOTES, ...Array<keyof typeof EMOTES>],
);
export const ExpressionSchema = z.enum([
  'neutral',
  'happy',
  'curious',
  'surprised',
  'proud',
]);
export const GestureToolSchema = z.object({ gesture: GestureSchema }).strict();
export const ExpressionToolSchema = z
  .object({ expression: ExpressionSchema })
  .strict();
export type Gesture = z.infer<typeof GestureSchema>;
export type Expression = z.infer<typeof ExpressionSchema>;
export type CharacterPhase =
  'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';
