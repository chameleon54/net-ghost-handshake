// The difficulty the game is played on. For now only the dev panel changes it; the real setting is milestone 7.5.
export type Difficulty = 'easy' | 'normal' | 'hard';
export const difficultySetting: { current: Difficulty } = { current: 'normal' };
