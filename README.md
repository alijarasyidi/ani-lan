# AniLAN

> A lightweight, self-hosted anime web interface for your home LAN.

AniLAN is a local web application that provides a simple, mobile-friendly interface for watching anime through an existing [`ani-cli`](https://github.com/pystardust/ani-cli) installation.

Instead of maintaining its own anime catalog or streaming infrastructure, AniLAN acts as a thin web layer around `ani-cli`. It handles the web experience while delegating anime searching and stream resolution to `ani-cli`.

The goal is simple:

```text
📱 Open AniLAN
      ↓
🔎 Search anime
      ↓
📺 Select episode
      ↓
▶️ Watch
```

---

## ✨ Features

The initial version intentionally focuses on the essentials:

- 🔎 Search anime through `ani-cli`
- 📋 Browse available anime results
- 🎞️ Select episodes
- ▶️ Watch through a browser-based video player
- 📱 Mobile-friendly interface
- 🏠 Designed for private home-LAN usage
- 🐧 Runs locally in Linux/WSL
- 🪶 Lightweight with minimal infrastructure

---

## 🏗️ Architecture

AniLAN is designed as a thin layer between the user's browser and `ani-cli`.

```text
                         Home LAN
                            │
                            ▼
                    ┌───────────────┐
                    │     Phone     │
                    │    Browser    │
                    └───────┬───────┘
                            │
                         HTTP
                            │
                            ▼
                    ┌───────────────┐
                    │    AniLAN     │
                    │               │
                    │  Web UI       │
                    │  HTTP API     │
                    └───────┬───────┘
                            │
                            ▼
                    ┌───────────────┐
                    │ AniCliService │
                    └───────┬───────┘
                            │
                            ▼
                       ┌─────────┐
                       │ ani-cli │
                       └────┬────┘
                            │
                            ▼
                    Streaming Provider
```

AniLAN does **not** attempt to replace `ani-cli`.

The application isolates `ani-cli` integration behind a service layer so that the underlying provider implementation can potentially be changed in the future without requiring major changes to the web interface.

---

## 🛠️ Technology

### Backend

- Node.js
- TypeScript
- Fastify
- Node.js subprocess APIs

### Frontend

- HTML
- CSS
- Vanilla JavaScript
- HTML5 Video

### Runtime

- Linux / WSL
- Local home network

The initial version deliberately avoids unnecessary infrastructure:

- No database
- No Docker
- No cloud hosting
- No authentication
- No reverse proxy
- No React requirement

---

## 📁 Project Structure

The intended structure is:

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

The structure may evolve as the project develops, but responsibilities should remain separated between:

- HTTP/API handling
- `ani-cli` integration
- Frontend presentation

---

## 🚀 Getting Started

> This section describes the intended setup. Commands may change as implementation progresses.

### Prerequisites

You need:

- Linux or WSL
- Node.js
- npm
- `ani-cli`

Verify that `ani-cli` is available:

```bash
ani-cli --version
```

Verify Node.js:

```bash
node --version
npm --version
```

### Install

Clone the repository and install dependencies:

```bash
npm install
```

### Run in development

```bash
npm run dev
```

By default, AniLAN should listen on:

```text
0.0.0.0:3000
```

### Build

```bash
npm run build
```

### Run production build

```bash
npm start
```

---

## 📱 Accessing AniLAN from Your Phone

AniLAN is intended to be accessed from a device connected to the same home network.

The server listens on all interfaces:

```text
0.0.0.0:3000
```

Find the host machine's LAN IP and open:

```text
http://<LAN-IP>:3000
```

For example:

```text
http://192.168.1.100:3000
```

If the application cannot be reached from another device, check the host's firewall/network configuration.

AniLAN should **not** be exposed directly to the public internet.

---

## ⚙️ Configuration

The application should support environment-based configuration.

Example:

```env
HOST=0.0.0.0
PORT=3000
ANICLI_BIN=ani-cli
```

### `HOST`

Address the HTTP server listens on.

Default:

```text
0.0.0.0
```

### `PORT`

HTTP server port.

Default:

```text
3000
```

### `ANICLI_BIN`

The executable used to invoke `ani-cli`.

Default:

```text
ani-cli
```

---

## 🔌 API

The initial API is intentionally small.

### Search

```http
GET /api/search?q=<query>
```

Searches for anime using `ani-cli`.

### Anime

```http
GET /api/anime/:id
```

Returns information required to display the anime's available episodes.

### Episode

```http
GET /api/anime/:id/episode/:episode
```

Resolves the selected episode into a browser-playable stream when supported.

The API should remain independent of the underlying `ani-cli` implementation.

---

## ▶️ Video Playback

AniLAN prefers to return a resolved stream URL directly to the browser rather than proxying the entire video through the local server.

Preferred flow:

```text
Phone
  │
  ▼
AniLAN
  │
  ▼
ani-cli
  │
  ▼
Stream URL
  │
  ▼
Phone Browser
```

This avoids unnecessarily routing the entire video through AniLAN.

If a provider requires additional handling — such as specific headers, CORS workarounds, or browser-incompatible streams — a backend streaming proxy may be introduced later.

---

## 🔐 Security

AniLAN is designed primarily for trusted home-LAN environments.

The initial version does not provide:

- Authentication
- User accounts
- HTTPS
- Public access controls

Nevertheless, the server must still:

- Validate API input
- Avoid unsafe shell command construction
- Prevent arbitrary command execution
- Prevent arbitrary filesystem access
- Handle subprocess failures safely

User input must never be directly concatenated into shell commands.

---

## 🎯 Scope

### Current goal

Build the smallest useful experience:

```text
Search
  ↓
Anime selection
  ↓
Episode selection
  ↓
Playback
```

### Out of scope for the initial version

The following should not be implemented unless the project's scope is explicitly expanded:

- User accounts
- Authentication
- Favorites
- Watch history
- Recommendations
- Ratings
- Comments
- Anime database
- MAL/AniList integration
- Downloading
- Transcoding
- Torrent functionality
- Cloud deployment
- Public hosting
- Docker/Kubernetes
- Sophisticated UI
- Multi-user support

---

## 🧭 Design Philosophy

AniLAN follows a few simple principles.

### Keep it local

The application is designed to run on your own machine and serve devices on your home network.

### Keep it thin

AniLAN should not rebuild functionality that `ani-cli` already provides.

### Keep it simple

A working search → episode → playback flow is more important than adding features.

### Isolate provider logic

All `ani-cli`-specific behavior should remain behind the `AniCliService` abstraction.

This allows the implementation to evolve from:

```text
AniLAN → ani-cli
```

to potentially:

```text
AniLAN → another provider
```

without redesigning the entire application.

---

## 🗺️ Roadmap

### v0 — Basic Viewer

- [ ] Node.js + TypeScript project
- [ ] Fastify server
- [ ] LAN-accessible web interface
- [ ] `ani-cli` integration
- [ ] Anime search
- [ ] Anime selection
- [ ] Episode selection
- [ ] Stream resolution
- [ ] HTML5 video player
- [ ] Mobile-responsive layout
- [ ] Basic error handling

### Future

Potential future features may include:

- Watch history
- Favorites
- Continue watching
- Anime metadata
- Better search
- PWA support
- Multiple provider support
- Improved playback handling
- Home-screen installation
- Optional authentication

These features are intentionally deferred until the core experience is stable.

---

## 📜 License

License information will be added when the project license is decided.

AniLAN is an independent project and relies on external software such as `ani-cli`. Refer to the respective projects for their licenses and terms.

---

## 🌟 North Star

> **AniLAN should make it effortless to open a browser on a phone connected to the home network, search for an anime, select an episode, and start watching.**

Everything else is secondary.