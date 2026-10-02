/**
 * onboarding.ts - who has seen the welcome tour.
 *
 * The tour opens the first time someone signs in. "Seen" is kept per account
 * id under a synced preference key, so a second device does not show it
 * again, and two people sharing a browser each get their own first time.
 * Pure, ASCII-only.
 */
export const ONBOARDING_KEY = "cleanmath:onboarded:v1";
/** Bump to show a reworked tour to everyone once more. */
export const TOUR_VERSION = 1;

export interface OnboardingState {
  version: number;
  /** Account ids that finished or skipped this version of the tour. */
  seen: string[];
}

export function reviveOnboarding(raw: string | null): OnboardingState {
  try {
    const r = JSON.parse(raw ?? "null") as Partial<OnboardingState> | null;
    if (r && r.version === TOUR_VERSION && Array.isArray(r.seen)) return { version: TOUR_VERSION, seen: r.seen.filter((x) => typeof x === "string").slice(-20) };
  } catch {
    // Unreadable: treat as never seen.
  }
  return { version: TOUR_VERSION, seen: [] };
}

export const shouldOnboard = (state: OnboardingState, userId: string | null | undefined): boolean => !!userId && !state.seen.includes(userId);

export function markSeen(state: OnboardingState, userId: string): OnboardingState {
  return state.seen.includes(userId) ? state : { version: TOUR_VERSION, seen: [...state.seen, userId].slice(-20) };
}
