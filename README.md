# Squiggle

A Discord bot for communities that want to celebrate what their members are up to. Members share accomplishments via a slash command; the server votes by reacting with emoji; temporary roles are granted, extended by new voters, and automatically expire.

Tailored to one server's specific vibe — but the mechanics are general enough to adapt.

## Features

- `/did-a-thing` — slash command where members share an accomplishment and get a temporary role
- **Reaction roles** — when a message hits a reaction threshold, the author gets a temporary role; the grant announcement credits everyone who reacted to it (e.g. "Alice and Bob determined irrg to be THE ABSOLUTE BEST")
- **Combined reaction roles** — requires multiple different emoji to all hit threshold on the same message (e.g. "best" + "worst" → a third role)
- **Auto-forwarding** — optionally forwards the triggering message to a configured channel when a role is first granted
- **Forward veto** — anyone can react 🚫 on a bot-forwarded message to delete it (e.g. if the original author would rather post it themselves)
- **Extensions** — each genuinely new reactor adds 4 hours to the role's expiration, announced as a card matching the grant announcement's look and phrasing (e.g. "Alice and Bob determined irrg to be THE ABSOLUTE BEST and extended their role for another four hours")
- **Reaction debouncing** — grants/extensions on a message are evaluated once a burst of reactions goes quiet (a few seconds), not once per reaction, and multiple roles affected in that window are announced in a single card that credits everyone who reacted during it, instead of spamming one per role
- **Auto-expiry** — all roles expire after 16 hours; a worker cleans them up automatically
- **Retired, not deleted** — however a role's record stops being active (natural expiry, superseded by a later grant of the same role, revoked because reactions dropped, or manually expired via `/squiggle expire`), the record is marked spent rather than removed. That message is permanently retired for that role — later reactions on it can't trigger a "new" besting/worsting — and the history still counts toward `/squiggle leaderboard`
- `/squiggle leaderboard` — top 3 members per configured reaction role, open to everyone
- `/squiggle` — admin commands: list active temp roles, manually expire a role, manually grant a role, trigger the worker on demand, or preview the monthly post (Administrator permission required)
- `/squiggle preview` — admin-only ephemeral preview of the monthly post as it would read right now, covering the month in progress instead of the last closed one. `period: year-end` previews the January wrap-up's shape months before January. Every label is marked "(so far)" / "(preview)" so it can't be mistaken for the real post
- **Monthly leaderboard post** — posted publicly on the 1st of each month at 9am Central, in each guild's system channel by default (or `workers.leaderboardChannel` if set). Each ranking shows two windows stacked together: the month that just ended, and year-to-date. The January post reports December alongside the completed prior year, retitled as that year's wrap-up — so the year-end callout is the same post with different labels, not a separate job

## Requirements

- Node.js 22+
- A Discord bot token with the following intents: `Guilds`, `GuildMembers`, `GuildMessages`, `GuildMessageReactions`

## Setup

### 1. Clone and install

```bash
git clone https://github.com/irrg/squiggle.git
cd squiggle
npm install
```

### 2. Configure

Copy the example config and fill it in:

```bash
cp config/config.json.example config/config.json
```

See [Configuration](#configuration) below.

### 3. Environment variables

Create a `.env` file in the project root:

```env
DISCORD_TOKEN=your-bot-token-here
DB_STORAGE=./squiggle.db
```

`DB_STORAGE` is the path to the database file. Omit it to use an in-memory database (data lost on restart).

### 4. Run

```bash
# Development
npm run dev

# Production
npm start
```

## Configuration

`config/config.json` controls everything about how the bot behaves. See `config/config.json.example` for the full schema. Below is an annotated example:

```json
{
  "bot": {
    "namePrefix": "prod",
    "commandPrefix": "",
    "blacklist": ["bot-testing"]
  },
  "commands": {
    "didAThing": [
      {
        "name": "coding",
        "role": "People who wrote some code today",
        "color": "#5865F2"
      }
    ]
  },
  "workers": {
    "leaderboardChannel": "squiggle-leaderboard",
    "reactionRoles": [
      {
        "emojiName": "👍",
        "threshold": 4,
        "roleName": "People who said something good",
        "color": "#57F287",
        "forwardChannel": "good-posts"
      }
    ],
    "combinedReactionRoles": [
      {
        "emojiNames": ["ThumbsUp", "ThumbsDown"],
        "threshold": 4,
        "roleName": "People who contain multitudes",
        "color": "#FEE75C",
        "forwardChannel": "chaotic-neutral-posts"
      }
    ]
  }
}
```

**`bot`**

- `namePrefix` — prepended to the bot's name in debug messages
- `commandPrefix` — prepended to all slash command names
- `whitelist` / `blacklist` — restrict which channels the bot will post in (use one or neither)

**`commands.didAThing`** — list of things members can share. Each needs a `name` (shown in the slash command dropdown), a Discord `role` name to grant, and a hex `color` for the embed.

**`workers.reactionRoles`** — emoji reaction thresholds. `emojiName` can be a Unicode emoji or a custom server emoji name. `threshold` is the number of human reactions required. `forwardChannel` is optional.

**`workers.combinedReactionRoles`** — like reactionRoles, but all emoji in `emojiNames` must independently hit `threshold` on the same message.

**`workers.leaderboardChannel`** — optional channel name override for the monthly leaderboard post (the 1st of each month at 9am Central). If omitted, each guild's system channel is used (the one Discord designates for join/boost messages — stays correct even if that channel gets renamed), falling back to a channel literally named "general" if no system channel is set. If neither resolves, that guild is skipped that month. The `/squiggle leaderboard` command works regardless of this setting, and stays an all-time ranking rather than a windowed one.

## Development

```bash
npm test          # run test suite
npm run test:watch  # watch mode
npm run lint      # ESLint
npm run format    # Prettier
npm run dev:watch # dev server, restarts on file changes
```

## Discord bot permissions

The bot needs the following permissions in your server:

- Read Messages / View Channels
- Send Messages
- Add Reactions
- Manage Roles (to grant and remove temporary roles)
- Read Message History (to handle partial reactions on old messages)

The bot's role must be positioned **above** any roles it manages in the server's role list.
