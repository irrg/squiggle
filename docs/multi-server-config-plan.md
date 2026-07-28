# Multi-server config + Discord-editable config — plan (ideas only)

## Current state

Config is one flat `config/config.json`, statically imported at module load
time (no `guildId` anywhere in the path). Two known import sites:
`src/utils/canPostInChannel.js` and `src/index.js` (which also passes it into
`reactions.js` via deps).

The data layer is already halfway there: `TempRole` rows are scoped by
`guildId` (see `commands/squiggle.js` list command), and `index.js` already
loops over joined guilds to clear per-guild application commands. The gap is
specifically the config layer, which has no per-guild concept at all.

## Multi-server config

Core change: config goes from a static import to a runtime per-guild lookup.

- New model (`models/config.js`, mirroring `models/tempRole.js`) storing
  config docs keyed by `guildId`, same nedb approach as TempRole.
- `config/config.json.example` becomes the _default template_ for new
  guilds, not the live source of truth.
- Every static `import config from "../../config/config.json"` becomes "look
  up config for this guild":
  - `canPostInChannel.js` needs a `guildId` param.
  - `index.js` (`config.bot.namePrefix`, worker loop) needs guild-aware
    access.
  - `reactions.js` already receives config via deps — trivial to swap for a
    per-guild lookup keyed by `message.guild.id`.
  - Command handlers (`did-a-thing.js`, `squiggle.js`) that read
    `commands.didAThing` choices need the same treatment.
- **Sharpest edge:** Discord slash-command _option choices_ (e.g.
  didAThing's list of "coding"/etc.) are baked in at command-registration
  time. If that list differs per guild, global commands no longer work —
  must register per-guild (`Routes.applicationGuildCommands`) with
  guild-specific bodies. This is a bigger lift than everything else
  combined.
- Bootstrap: on first join / first run, seed a guild's config row from the
  example template.
- Tests: several (`loaders.test.js`, command tests) statically import
  config — need refactoring to inject fixture config instead.

## Discord-editable config

Depends on the above — need a per-guild store before it's editable via
Discord at all.

- New admin-only command, e.g. `/squiggle config`, gated by `ManageGuild`
  permission or an admin role check.
- Config shape is nested arrays of objects (reactionRoles,
  combinedReactionRoles, didAThing entries) — doesn't map cleanly to flat
  slash-command options. Two paths:
  - **Structured subcommands** per field, e.g.
    `/squiggle config reaction-role add emoji:🤷 threshold:4 role:@Name
color:#00FF00` — more command surface, but safe inputs, no parse step.
  - **Modal + raw JSON blob** — paste/edit a full config section as text,
    validate JSON + schema on submit. Much less command surface, but needs
    solid validation (bad hex color, missing role name, malformed JSON must
    not reach the reaction handler and crash it).
- Validation layer is mandatory either way — this is the part most likely to
  bite if skipped.
- `/squiggle config show` — dump the current guild's config (embed or file
  attachment).
- Live-reload: config can no longer be "load once at startup" — must hit the
  store per access, or cache with invalidation on edit (same shape problem
  as the command-list refresh above — if choices change, guild commands need
  re-`PUT`).
- Audit trail: reuse the existing `sendDebugMessage` pattern to log who
  edited what, when.

## Suggested order

1. Per-guild config store + wire all static-import sites to guildId-aware
   lookup (foundation, no user-facing change yet).
2. Guild-scoped command registration (only if choices actually need to vary
   per guild — confirm that's required before building it).
3. `/squiggle config show` (read-only, low risk, validates the store works).
4. `/squiggle config` editing subcommands + validation + audit log.
