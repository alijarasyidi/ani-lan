# AniLAN Development Plan

This plan follows `docs/SPEC.md` and keeps AniLAN as a thin web layer around
the existing `ani-cli` installation.

## Prerequisite

Status: complete

- Install native Linux Node.js and npm inside the WSL1 Ubuntu environment.
- Verify Node.js, npm, and `ani-cli` from that same environment.

## Phase 1: Server

Status: complete

- Create the minimal Node.js and TypeScript project.
- Add Fastify and static frontend serving.
- Add a health endpoint.
- Bind the server to `HOST` and `PORT`, defaulting to `0.0.0.0:3000`.
- Verify local access and document LAN access through the Windows host IP.

## Phase 2: ani-cli Integration

- Detect the configured `ani-cli` executable and verify its version.
- Implement controlled subprocess execution with argument arrays, timeouts,
  output limits, and serialized requests.
- Keep all `ani-cli`-specific parsing and adapter behavior in `AniCliService`.
- Prototype fixed adapter hooks for capturing search results, episode numbers,
  and resolved stream URLs.
- Use opaque selection identifiers when the CLI does not expose provider IDs.

## Phase 3: Search

- Validate `GET /api/search?q=<query>` input.
- Invoke `ani-cli` through `AniCliService`.
- Return only reliably extracted result fields.
- Display selectable results in the vanilla frontend.

## Phase 4: Episodes

- Validate anime selection identifiers.
- Add `GET /api/anime/:id`.
- Retrieve and display available episode numbers.

## Phase 5: Playback

- Validate episode numbers.
- Add `GET /api/anime/:id/episode/:episode`.
- Resolve the episode through `ani-cli`.
- Return a direct stream URL when browser playback supports it.
- Do not add a proxy or HLS workaround unless target-device testing requires it.

## Phase 6: Mobile UX

- Keep the UI limited to search, results, episodes, and a video player.
- Use responsive layout, large tap targets, and `playsinline` video playback.
- Add loading and human-readable error states.

## Phase 7: Verification and Documentation

- Test build, development, and production commands inside WSL1.
- Test the complete search-to-play flow from a phone on the home LAN.
- Verify invalid input, subprocess failures, timeouts, and missing `ani-cli`.
- Document setup, configuration, LAN access, firewall requirements, stopping,
  and known provider/browser limitations.

## Explicit Non-Goals

- No database, authentication, accounts, history, favorites, recommendations,
  downloads, transcoding, torrent support, Docker, React, cloud deployment,
  reverse proxy, or public hosting.
