export const HOUR_MS = 60 * 60 * 1000;

// How long a /did-a-thing role lasts
export const DID_A_THING_DURATION_MS = 24 * HOUR_MS;

// How long reaction-granted and admin-granted temp roles last
export const TEMP_ROLE_DURATION_MS = 16 * HOUR_MS;

// How much each new high-water-mark reaction extends a temp role
export const TEMP_ROLE_EXTENSION_MS = 4 * HOUR_MS;
