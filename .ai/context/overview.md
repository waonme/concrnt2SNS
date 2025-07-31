# overview.md

This file provides guidance to developers when working with code in this repository.

## Project Overview

concrnt2SNS is a Node.js-based bot application that monitors messages from Concrnt (a decentralized social platform) and automatically cross-posts them to multiple mainstream social networks including Twitter/X, Bluesky, Threads, and Nostr. The project focuses on real-time message synchronization with platform-specific adaptations for content formatting and media handling.

## Installation and Environment

The project uses npm for dependency management with Node.js 20+ required for `--env-file` support:

- **npm installation**: `npm install` to install all dependencies
- **Node.js requirement**: 20.0 or later (for `--env-file` support)
- **Environment setup**: Copy `.env.example` to `.env` and configure API credentials

All configuration is managed through environment variables in the `.env` file.

## Common Development Commands

### Running the Application
```bash
# Start the main application
npm start

# Run in debug mode with Node inspector
npm test
```

### Environment Variables Setup
```bash
# Core settings
CC_SUBKEY="your-concrnt-subkey"
LISTEN_TIMELINE="timeline-id@host.com"  # Optional, defaults to home timeline
LISTEN_TIMELINE_TW="twitter-only-timeline@host.com"  # Optional Twitter-only timeline

# Platform toggles
TW_ENABLE="true"
BS_ENABLE="true"
THREADS_ENABLE="true"
NOSTR_ENABLE="true"

# API credentials (see README for full list)
```

### Multiple Account Configuration
```bash
# Additional Twitter accounts
TWITTER_ACCOUNT1_API_KEY="xxx"
TWITTER_ACCOUNT1_API_KEY_SECRET="xxx"
TWITTER_ACCOUNT1_ACCESS_TOKEN="xxx"
TWITTER_ACCOUNT1_ACCESS_TOKEN_SECRET="xxx"

# Timeline routing
TIMELINE_1_ID="timeline-id@host.com"
TIMELINE_1_TARGETS="twitter:account1,bluesky:account1"
```

### Testing and Development
- Set `DRY_RUN="true"` in `.env` to test without actually posting
- Use `npm test` for debugging with Node inspector enabled
- Monitor console output for real-time message processing logs

## Code Architecture

### Core Structure
- `src/concrnt2SNS.js`: Main entry point, WebSocket connection management, message routing
- `src/Clients/`: Platform-specific client implementations
- `src/Utils/`: Shared utilities for message processing and media handling

### Client Modules
- `src/Clients/Twitter.js`: Twitter/X API v2 client with optional IFTTT webhook support
- `src/Clients/AtProtocol.js`: Bluesky client using AT Protocol
- `src/Clients/Threads.js`: Meta Threads API client
- `src/Clients/Nostr.js`: Nostr protocol client with multi-relay support

### Utility Modules
- `src/Utils/ConcrntMessageAnalysis.js`: Parses Concrnt markdown, extracts mentions and media
- `src/Utils/Media.js`: Downloads and processes media files, handles content warnings
- `src/Utils/OgImage.js`: Fetches Open Graph images for link previews

### Key Components
- **WebSocket Connection**: Real-time message monitoring via `@concrnt/client`
- **Message Processing**: Markdown parsing, mention extraction, media reference handling
- **Platform Adaptation**: Each platform has specific formatting and media handling rules
- **Error Handling**: Retry logic with exponential backoff for transient failures
- **Duplicate Prevention**: Tracks recent message IDs to prevent cross-timeline duplicates

### Configuration System
- All configuration via environment variables (`.env` file)
- Platform-specific settings and API credentials
- Support for multiple accounts and timeline-based routing
- Optional IFTTT webhook integration for Twitter rate limit workarounds

### Platform-Specific Behaviors
#### Content Warnings
- **Twitter**: All media becomes blurred with warning (except video-only posts due to API limitations)
- **Bluesky**: All media gets content warning labels
- **Nostr**: Entire post gets content warning wrapper
- **Threads**: No content warning support (media posted as-is)

#### Media Handling
- Automatic download and processing of Concrnt media attachments
- Image manipulation using Sharp library
- Platform-specific size and format requirements
- Graceful fallback on media download failures

## Development Notes
- ES modules used throughout (`"type": "module"` in package.json)
- Async/await pattern for all asynchronous operations
- No formal test suite - relies on manual testing and dry-run mode
- Designed for continuous operation (use pm2 or similar for production)
- Supports both single timeline and dual timeline monitoring (general + Twitter-only)
- IFTTT webhook support helps bypass Twitter API rate limits for high-volume posting