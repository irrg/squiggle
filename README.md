# Squiggle

A Discord bot for communities that want to celebrate what their members are up to. Members share accomplishments via a slash command; the server votes by reacting with emoji; temporary roles are granted, extended by new voters, and automatically expire.

Tailored to one server's specific vibe — but the mechanics are general enough to adapt.

## Features

- `/did-a-thing` — slash command where members share an accomplishment and get a temporary role
- **Reaction roles** — when a message hits a reaction threshold, the author gets a temporary role
- **Combined reaction roles** — requires multiple different emoji to all hit threshold on the same message (e.g. "best" + "worst" → a third role)
- **Auto-forwarding** — optionally forwards the triggering message to a configured channel when a role is first granted
- **Extensions** — each genuinely new reactor adds 4 hours to the role's expiration
- **Auto-expiry** — all roles expire after 16 hours; a worker cleans them up automatically

## Requirements

- Node.js 24+
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
DB_NAME=squiggle
DB_USER=squiggle
DB_PASSWORD=
DB_HOST=localhost
DB_DIALECT=sqlite
DB_STORAGE=./squiggle.db
```

For SQLite (the default), `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_HOST` can be anything — only `DB_DIALECT` and `DB_STORAGE` matter.

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
    "env": "prod",
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

## Development

```bash
npm test          # run test suite
npm run test:watch  # watch mode
npm run lint      # ESLint
npm run format    # Prettier
```

## Discord bot permissions

The bot needs the following permissions in your server:

- Read Messages / View Channels
- Send Messages
- Add Reactions
- Manage Roles (to grant and remove temporary roles)
- Read Message History (to handle partial reactions on old messages)

The bot's role must be positioned **above** any roles it manages in the server's role list.
