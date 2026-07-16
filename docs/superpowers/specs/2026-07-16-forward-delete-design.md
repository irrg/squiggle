# 🚫 Reaction Deletes Forwarded Messages

Date: 2026-07-16
Status: Approved

## Purpose

When the bot forwards a member's message to a showcase channel (`forwardChannel`
on a reaction role), the member may prefer to post it themselves. Anyone in the
forward channel can react 🚫 on the forwarded message to delete it.

## Design

Stateless detection in `handleReactionAdd` (src/handlers/reactions.js). No DB
tracking — forwards are identified by intrinsic message properties.

New guard block near the top of `handleReactionAdd`, after the partial-message
fetch and bot-self-reaction guard, **before** `canPostInChannel` and
author-resolution guards (forward channels may not be whitelisted, and forwards
are bot-authored so the current code bails before reaching them).

Delete when ALL hold:

1. `reaction.emoji.name === "🚫"`
2. `message.author?.id === client.user?.id` (bot's own message)
3. `message.reference?.type === MessageReferenceType.Forward` (discord.js
   14.26.5, enum from discord-api-types)
4. `message.channel.name` is one of the configured `forwardChannel` values,
   collected from `config.workers.reactionRoles` and
   `config.workers.combinedReactionRoles`

Action: `await message.delete()`, then return — no role logic runs on
forwards. Any error goes to `sendDebugMessage` via `formatError`; handler never
throws.

Permission model: anyone in the channel. A single 🚫 reaction suffices.

## Rejected alternatives

- **DB tracking of forward message ids** — precise but adds a collection,
  cleanup burden, and misses forwards created before deploy.
- **Delete any bot message on 🚫** — too blunt; would delete announcement
  embeds.

## Tests

In `__tests__/handlers/reactions.test.js`:

- 🚫 on bot forward in forward channel → `message.delete()` called, no role
  logic runs
- 🚫 on a normal user message → no delete
- 🚫 on bot non-forward message → no delete
- 🚫 on bot forward in a non-forward channel → no delete
- `delete()` rejects → debug message sent, handler resolves
