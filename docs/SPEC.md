# Anime Web Proxy — North Star Specification

## 1. Purpose

Build a small, local, mobile-friendly web app for watching anime at home by using the existing `ani-cli` installation as the backend's anime/stream resolver.

The app is intentionally minimal. It is **not** an anime catalog, streaming platform, or media-management system.

The first version should do only three things well:

1. Accept an anime search query.
2. Let the user select an anime/episode.
3. Play the resolved video in a browser.

The app is intended to be accessed from a phone over the local home network.

---

## 2. Core Architecture

```text
                         Home Wi-Fi
                             │
                             ▼
                       ┌───────────┐
                       │   Phone   │
                       │  Browser  │
                       └─────┬─────┘
                             │ HTTP
                             ▼
                    ┌─────────────────┐
                    │      WSL1       │
                    │                 │
                    │  Node.js API    │
                    │       │         │
                    │       ▼         │
                    │    ani-cli      │
                    └─────────────────┘
```

### Runtime location

The web application MUST run inside the same WSL1 environment where `ani-cli` already lives.

Do not move `ani-cli` to Windows.

Do not introduce Docker for the initial version.

### Network

The server should listen on `0.0.0.0`, not only `127.0.0.1`, so the application can be reached from other devices on the home LAN.

Example:

```text
http://<windows-host-lan-ip>:3000
```

Windows Firewall may need to allow the selected port.

---

## 3. Technology Stack

### Backend

- Node.js
- TypeScript
- Fastify
- Node.js `child_process` APIs for invoking `ani-cli`

### Frontend

For v0:

- HTML
- CSS
- Vanilla JavaScript

Do **not** introduce React unless the UI becomes sufficiently complex to justify it.

### Build/runtime

Use a simple TypeScript development/build workflow.

No database is required.

No authentication is required.

No cloud deployment is required.

No reverse proxy is required for v0.

---

## 4. Project Structure

Recommended structure:

```text
anime-web/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── server.ts
│   ├── routes/
│   │   ├── search.ts
│   │   └── anime.ts
│   └── services/
│       └── ani-cli.ts
└── public/
    ├── index.html
    ├── app.js
    └── style.css
```

The exact structure may evolve, but responsibilities should remain separated.

---

## 5. Responsibilities

### HTTP/API layer

Responsible for:

- validating requests
- calling the service layer
- returning JSON
- handling errors
- serving the frontend

It must NOT contain `ani-cli` parsing logic.

### AniCliService

Responsible for all interaction with `ani-cli`.

Conceptually:

```ts
class AniCliService {
    async search(query: string) {}
    async getEpisodes(anime: string) {}
    async resolveEpisode(anime: string, episode: number) {}
}
```

The exact implementation depends on what `ani-cli` exposes and how its current CLI output behaves.

The rest of the application should not need to know how `ani-cli` works internally.

This abstraction is important because the implementation may later change from:

```text
AniCliService → execute ani-cli
```

to:

```text
AniCliService → directly use a provider/API
```

without requiring a frontend rewrite.

---

## 6. API Design

The initial API should be intentionally small.

### Search

```http
GET /api/search?q=<query>
```

Purpose:

Search for anime using `ani-cli`.

Example conceptual response:

```json
{
  "results": [
    {
      "id": "...",
      "title": "One Piece"
    }
  ]
}
```

The exact fields should follow what can be reliably extracted from `ani-cli`.

Do not invent metadata that `ani-cli` does not provide.

---

### Anime / Episode List

```http
GET /api/anime/:id
```

Purpose:

Return the available episodes for the selected anime.

Example conceptual response:

```json
{
  "id": "...",
  "title": "One Piece",
  "episodes": [
    {
      "number": 1,
      "title": "..."
    },
    {
      "number": 2,
      "title": "..."
    }
  ]
}
```

---

### Resolve Episode

```http
GET /api/anime/:id/episode/:episode
```

Purpose:

Resolve an episode into something playable by the browser.

Example conceptual response:

```json
{
  "title": "One Piece",
  "episode": 1,
  "streamUrl": "..."
}
```

The frontend should use the returned stream URL in the HTML5 video player when possible.

---

## 7. Video Playback Strategy

### Preferred approach

Do not proxy or transcode the complete video through Node.js unless necessary.
The browser receives a same-origin AniLAN stream URL, while AniLAN proxies the
HLS playlist and media requests required for playback.

Preferred flow:

```text
Phone
  │
  │ request stream URL
  ▼
Node.js
  │
  │ resolve
  ▼
ani-cli
  │
  ▼
Provider stream
  │
  ▼
AniLAN HLS proxy
  │
  ▼
Phone browser
```

This handles provider-specific CORS and referrer requirements without
downloading and re-uploading the complete video through Node.js.

The proxy forwards the provider referrer captured from `ani-cli` and rewrites
HLS playlist resources to same-origin AniLAN URLs. Browser-native HLS support
is still required.

---

## 8. Frontend Scope

The UI should contain only:

### Search

A single text input and search button.

Example:

```text
┌──────────────────────────────┐
│ Search anime...           🔍 │
└──────────────────────────────┘
```

### Anime results

Display a simple selectable list.

```text
Search results

One Piece
One Piece: Episode of East Blue
One Piece Film: ...
```

### Episode selection

After selecting an anime:

```text
Episodes

Episode 1
Episode 2
Episode 3
Episode 4
...
```

### Video player

Display a standard HTML5 video player.

```html
<video controls playsinline></video>
```

The player must work well on mobile browsers.

---

## 9. Mobile-first Requirements

The app MUST be usable on a phone.

Requirements:

- responsive layout
- no desktop-only interactions
- large tap targets
- readable text
- video player should fit viewport width
- avoid horizontal scrolling
- search input should work comfortably with a mobile keyboard
- episode list should be easy to tap
- use `playsinline` on the video element

Do not spend time building a sophisticated visual design.

Simple and functional is the goal.

---

## 10. UX Flow

The complete initial user flow should be:

```text
Open app
   │
   ▼
Search anime
   │
   ▼
Select anime
   │
   ▼
Select episode
   │
   ▼
Resolve stream
   │
   ▼
Video player
```

There should be no requirement for:

- login
- account creation
- favorites
- watch history
- recommendation system
- anime metadata pages
- settings page
- admin dashboard

---

## 11. ani-cli Integration Rules

`ani-cli` is an external dependency of this application.

The application MUST:

1. Detect whether `ani-cli` is available.
2. Invoke it through a controlled subprocess.
3. Capture stdout/stderr as appropriate.
4. Handle non-zero exit codes.
5. Avoid hanging requests indefinitely.
6. Avoid leaking raw subprocess errors directly to the browser.
7. Keep `ani-cli` interaction isolated inside `AniCliService`.

Do not assume that `ani-cli` output is a stable API.

Before implementing parsing, inspect the installed version and determine the safest machine-readable/non-interactive invocation available.

Prefer official/non-interactive options exposed by the installed `ani-cli` version over brittle terminal-output scraping.

---

## 12. Process Management

The backend must never assume that `ani-cli` is a long-running server.

Treat it as a subprocess/tool that is invoked when needed.

Important considerations:

- use async subprocess handling
- capture output safely
- set reasonable timeouts
- terminate abandoned subprocesses
- prevent multiple requests from accidentally interfering with one another
- avoid shell-string injection

User-provided search text MUST NOT be concatenated into an unsafe shell command.

Prefer argument arrays such as:

```ts
spawn("ani-cli", ["--some-option", query])
```

over:

```ts
exec(`ani-cli ${query}`)
```

---

## 13. Error Handling

The UI should show useful, simple errors.

Examples:

```text
Could not search anime.
```

```text
Could not load episodes.
```

```text
Could not resolve this episode.
```

```text
This stream cannot be played directly in the browser.
```

The server logs should contain the useful technical details.

Do not expose stack traces or raw command output to the phone.

---

## 14. Security Scope

This application is intended for a trusted home LAN.

For v0:

- no authentication
- no user accounts
- no HTTPS requirement
- no public internet exposure

However, basic security practices still apply:

- validate API input
- limit unreasonable query lengths
- never construct unsafe shell commands
- do not expose arbitrary command execution through HTTP
- do not allow arbitrary filesystem paths from API parameters

The server should be bound to the LAN interface through `0.0.0.0` only because LAN access is explicitly required.

Do NOT configure port forwarding or public exposure.

---

## 15. Configuration

Use environment variables for values that may change.

At minimum:

```text
PORT=3000
ANICLI_BIN=ani-cli
HOST=0.0.0.0
```

Do not hard-code an absolute path to the user's home directory unless required.

The default `ani-cli` command should be sufficient when it is available through `$PATH`.

---

## 16. Development Commands

The project should provide simple commands such as:

```bash
npm install
npm run dev
npm run build
npm start
```

The exact implementation is up to the agent.

The README should explain how to:

1. Install dependencies.
2. Verify `ani-cli` is available.
3. Start the server.
4. Find the Windows LAN IP.
5. Open the app from a phone.
6. Stop the server.

---

## 17. Acceptance Criteria

The v0 implementation is considered complete when all of the following work:

### Environment

- [ ] Node.js application runs inside WSL1.
- [ ] Existing `ani-cli` installation is detected.
- [ ] No Docker is required.
- [ ] No database is required.

### Search

- [ ] User can enter an anime name.
- [ ] User can submit the search from a phone.
- [ ] Backend invokes `ani-cli`.
- [ ] Search results are returned as JSON.
- [ ] Results are displayed in the browser.

### Episode selection

- [ ] User can select an anime.
- [ ] Available episodes can be retrieved.
- [ ] Episodes are displayed as selectable items.

### Playback

- [ ] User can select an episode.
- [ ] Backend resolves the episode.
- [ ] Browser receives a playable stream URL when supported.
- [ ] HTML5 video player loads the stream.
- [ ] Video controls work on mobile.

### Networking

- [ ] Server listens on `0.0.0.0`.
- [ ] App can be opened from another device on the same home network.
- [ ] Windows firewall/network configuration is documented if required.

### Error handling

- [ ] ani-cli failure does not crash the server.
- [ ] Invalid API requests return appropriate HTTP errors.
- [ ] Browser receives human-readable error messages.
- [ ] Server logs contain enough information for debugging.

---

## 18. Explicit Non-Goals

Do NOT implement these in v0:

- user authentication
- accounts
- favorites
- watch history
- database
- anime recommendations
- MAL/AniList integration
- ratings
- comments
- subtitles management
- transcoding
- download functionality
- torrent functionality
- Docker
- Kubernetes
- cloud hosting
- public deployment
- HTTPS certificates
- reverse proxy
- React
- sophisticated UI/UX
- automatic resume
- multi-user support

These may be considered later, but they should not delay the first working version.

---

## 19. Implementation Principles

### Keep the architecture thin

This application is a proxy/wrapper around `ani-cli`.

Do not rebuild ani-cli.

Do not build a new anime database.

Do not create unnecessary abstractions.

### Prefer working software over framework complexity

The first milestone should be:

```text
phone → search → select episode → play
```

Everything else is secondary.

### Keep provider-specific logic isolated

Anything that depends on the current behavior of `ani-cli` belongs inside:

```text
src/services/ani-cli.ts
```

The HTTP API and frontend should remain provider-agnostic.

### Design for replacement

The future architecture should allow:

```text
                 AniCliService
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
         ani-cli            direct provider
```

without changing the public API.

---

## 20. Suggested Development Order

Build in this order:

### Phase 1 — Server

- Create Node.js + TypeScript project.
- Add Fastify.
- Add health endpoint.
- Serve static frontend.
- Verify LAN access.

### Phase 2 — ani-cli integration

- Verify executable discovery.
- Experiment with non-interactive/search functionality.
- Build `AniCliService`.
- Parse/normalize results.

### Phase 3 — Search UI

- Add search input.
- Add `/api/search`.
- Display results.

### Phase 4 — Episode selection

- Add anime selection.
- Add episode endpoint.
- Display episodes.

### Phase 5 — Playback

- Resolve selected episode.
- Return stream URL.
- Connect it to HTML5 video.

### Phase 6 — Mobile polish

- Responsive layout.
- Touch-friendly controls.
- Loading states.
- Error states.

### Phase 7 — Documentation

Document:

- installation
- configuration
- starting/stopping
- LAN access
- troubleshooting
- known limitations

---

## 21. North Star

When making implementation decisions, optimize for this:

> **A tiny local web app that lets me open my phone, search anime through my existing ani-cli installation, select an episode, and watch it over my home network.**

If a proposed feature or technology does not directly help achieve that goal, defer it.

The first successful experience should be:

```text
📱 Open browser
      ↓
🔎 Search anime
      ↓
📺 Select episode
      ↓
▶️ Watch
```
