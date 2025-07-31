# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

concrnt2SNS is a Node.js application that monitors messages from Concrnt (a decentralized social platform) and cross-posts them to multiple social networks: Twitter/X, Bluesky, Threads, and Nostr.

## Essential Commands

```bash
# Install dependencies
npm install

# Start the application
npm start

# Run in test/debug mode
npm test

# Test IFTTT webhook integration
node test-webhook.js
```

**Note**: This project requires Node.js 20+ with `--env-file` support.

## Architecture

### Core Flow
1. WebSocket connection to Concrnt via `@concrnt/client`
2. Real-time message monitoring from specified timeline
3. Message analysis and formatting in `ConcrntMessageAnalysis.js`
4. Parallel posting to enabled platforms via client modules

### Key Components

- **Entry Point**: `src/concrnt2SNS.js` - Main application loop, WebSocket management, message routing
- **Client Modules** (`src/Clients/`): Each social platform has its own client module with platform-specific API handling
  - `AtProtocol.js`: Bluesky client using AT Protocol
  - `Nostr.js`: Nostr protocol client with relay management
  - `Threads.js`: Meta Threads API client
  - `Twitter.js`: Twitter/X API v2 client with optional IFTTT webhook support
- **Utilities** (`src/Utils/`):
  - `ConcrntMessageAnalysis.js`: Parses Concrnt markdown, extracts mentions, handles media references
  - `Media.js`: Downloads and processes media files, handles content warnings
  - `OgImage.js`: Fetches Open Graph images for link previews

### Platform-Specific Behaviors

- **Media with content warnings**: Each platform handles flagged media differently
  - Twitter: All media becomes blurred with warning (except video-only posts)
  - Bluesky: All media gets warning labels
  - Nostr: Entire post gets content warning
  - Threads: No content warning support
- **IFTTT Integration**: Twitter can optionally use webhooks for rate limit workarounds

### Configuration

All configuration is done via `.env` file with platform-specific settings and API credentials. Each platform can be individually enabled/disabled.

Key configuration options:
- `LISTEN_TIMELINE`: Primary timeline to monitor (defaults to home timeline)
- `LISTEN_TIMELINE_TW`: Twitter-only timeline that bypasses TW_ENABLE setting
- Platform-specific enable flags and credentials

#### Multiple Account Configuration

```bash
# Additional Twitter accounts
TWITTER_ACCOUNT1_API_KEY="xxx"
TWITTER_ACCOUNT1_API_KEY_SECRET="xxx"
TWITTER_ACCOUNT1_ACCESS_TOKEN="xxx"
TWITTER_ACCOUNT1_ACCESS_TOKEN_SECRET="xxx"

# Additional Bluesky accounts
BLUESKY_ACCOUNT1_IDENTIFIER="xxx"
BLUESKY_ACCOUNT1_APP_PASSWORD="xxx"
BLUESKY_ACCOUNT1_SERVICE="https://bsky.social"
```

#### Timeline Routing Configuration

```bash
# Route specific timeline to specific accounts
TIMELINE_1_ID="timeline-id@host.com"
TIMELINE_1_TARGETS="twitter:account1,bluesky:account1"

# Multiple platforms per timeline
TIMELINE_2_ID="another-timeline@host.com"
TIMELINE_2_TARGETS="twitter:default,bluesky:default,threads:default"
```

### Recent Updates

- **Multiple Timeline Support**: Can monitor both `LISTEN_TIMELINE` and `LISTEN_TIMELINE_TW` simultaneously
- **Twitter-Only Timeline**: Messages from `LISTEN_TIMELINE_TW` are posted only to Twitter, regardless of TW_ENABLE setting
- **Duplicate Prevention**: Tracks recent message IDs to prevent duplicate posts across timelines
- **Multiple Account Support**: Can configure multiple accounts for Twitter and Bluesky
- **Timeline-Based Routing**: Specific timelines can be routed to specific social media accounts

### Error Handling

- Transient failures include retry logic with exponential backoff
- Platform-specific errors are logged but don't stop the main loop
- Media download failures fall back gracefully

## Development Guidelines

- ES modules are used throughout (`"type": "module"`)
- Async/await pattern for all API calls
- Error handling includes retry logic for transient failures
- Media processing uses Sharp for image manipulation
- Each client module exports a single async function that handles the complete posting flow

### Testing

- Use `npm test` for debugging with Node inspector enabled
- `DRY_RUN="true"` in .env prevents actual posting while testing
- Test webhook functionality separately with `node test-webhook.js`