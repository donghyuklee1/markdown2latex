import { check, finish } from "./harness";
import { markSeen, ONBOARDING_KEY, reviveOnboarding, shouldOnboard, TOUR_VERSION } from "../src/lib/onboarding";
import { SYNC_KEYS } from "../src/lib/account";

const empty = reviveOnboarding(null);
check("first sign-in: tour shows", String(shouldOnboard(empty, "u1")), "true");
check("signed out: never shows on its own", String(shouldOnboard(empty, null)), "false");
const seen = markSeen(empty, "u1");
check("after finishing or skipping: not again", String(shouldOnboard(seen, "u1")), "false");
check("another account in the same browser still gets it", String(shouldOnboard(seen, "u2")), "true");
check("marking twice adds nothing", String(markSeen(seen, "u1") === seen), "true");
check("survives a round trip through storage", String(shouldOnboard(reviveOnboarding(JSON.stringify(seen)), "u1")), "false");
check("a new tour version shows again", String(shouldOnboard(reviveOnboarding(JSON.stringify({ version: TOUR_VERSION - 1, seen: ["u1"] })), "u1")), "true");
check("garbage in storage: treated as never seen", String(shouldOnboard(reviveOnboarding("{oops"), "u1")), "true");
check("the list stays short", String(Array.from({ length: 30 }, (_, i) => "u" + i).reduce(markSeen, empty).seen.length), "20");
check("synced, so a second device skips it", String((SYNC_KEYS as readonly string[]).includes(ONBOARDING_KEY)), "true");
finish("onboarding");
