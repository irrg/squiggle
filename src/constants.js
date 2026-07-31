export const HOUR_MS = 60 * 60 * 1000;

// How long a temp role lasts, however it was granted
export const TEMP_ROLE_DURATION_MS = 16 * HOUR_MS;

// How much each new high-water-mark reaction extends a temp role
export const TEMP_ROLE_EXTENSION_MS = 4 * HOUR_MS;

// How long to wait for reactions on a message to go quiet before granting
// and extending roles, so a burst of reactions collapses into one pass
// and one notification instead of one per reaction
export const REACTION_DEBOUNCE_MS = 7 * 1000;
