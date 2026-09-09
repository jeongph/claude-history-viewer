<div align="center">

<img src="assets/logo.svg" width="110" alt="Wake logo — a prow riding the crest of a W-shaped wave" />

# Wake

[한국어](./README.md) · **English**

**Trace the wake of your coding sessions.**

Follow the trail your Claude Code and Codex conversations leave behind — read, resume, and fork.

[![Release](https://img.shields.io/github/v/release/followingseas/wake?color=56B7C3&label=release)](https://github.com/followingseas/wake/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/followingseas/wake/total?color=1F7A93&label=downloads)](https://github.com/followingseas/wake/releases)
[![License](https://img.shields.io/badge/license-MIT-0B1F2A)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-E8F6F2)](https://github.com/followingseas/wake/releases/latest)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-56B7C3)](https://www.conventionalcommits.org/en/v1.0.0/)

<img src=".github/assets/hero.png" width="820" alt="Wake conversation viewer" />

</div>

---

The trail of water a ship leaves behind is called its *wake*. Local conversations with Claude Code and Codex leave a wake too, under `~/.claude` and `~/.codex`. **Wake is a desktop viewer that follows that trail** — read past sessions as beautifully typeset documents, pick up right where you left off, or fork a new course.

Everything happens on your local file system. The only network request is the update check (GitHub Releases); your conversation history is never sent anywhere.

## Features

- **📜 Read conversations** — Your input renders as terminal prompts, responses as typeset markdown (tables, syntax highlighting). Tool calls, thinking blocks, and system messages stay collapsed so the flow of the conversation is never interrupted.
- **🔍 Browse sessions** — Sessions grouped by project, with titles, last activity, and message counts. Narrow the list with `⌘F` by title, first message, or folder name.
- **🔦 Search message contents** — The search field up top (`⌘K`) searches what was actually said, across every project. One half-remembered word finds the session and the message, and picking a result jumps straight to it.
- **⏩ Resume in terminal** — Runs `claude --resume <id>` or `codex resume <id>` in the session's working directory.
- **🔱 Open as fork** — Uses Claude’s `--fork-session` or `codex fork <id>`, preserving the original.
- **🖥 Terminal of your choice** — Defaults to the OS terminal; pick iTerm2 or any detected terminal in Settings.
- **🗑 Safe deletion** — Claude sessions are moved to the Trash. Manage Codex deletion and archiving in Codex.
- **🌐 Bilingual UI** — Korean · English (follows your system language).

<div align="center">
<img src=".github/assets/settings.png" width="680" alt="Wake settings" />
</div>

## Installation

### Download (recommended)

[**Download the latest release →**](https://github.com/followingseas/wake/releases/latest)

Mount the `.dmg` and drag `Wake.app` into your Applications folder. A macOS (Apple Silicon) build is currently provided.

> The build is not signed or notarized, so Gatekeeper will warn you on first launch. Allow it via System Settings → Privacy & Security → "Open Anyway".

### Run from source

```bash
git clone https://github.com/followingseas/wake.git
cd wake
npm install
npm run dev
```

To build the app:

```bash
npm run build:mac     # macOS (.dmg)
npm run build:win     # Windows (installer .exe)
npm run build:linux   # Linux (AppImage, deb)
```

| Requirement | Notes |
|------|------|
| OS | macOS · Windows · Linux |
| Node.js | 20+ (for running/building from source) |
| CLI | `claude` or `codex` must be on PATH for that provider’s Resume/Fork. Reading and search do not require a CLI. |

> The viewer works on every OS. Terminal integration is verified on macOS (Terminal.app, iTerm2); Windows (Windows Terminal, cmd, PowerShell) and Linux (GNOME Terminal, Konsole, etc.) are implemented but less tested. Please open an issue if something breaks.

## Usage

> `⌘` means `Ctrl` on Windows and Linux. The app shows whichever applies to your platform.

| Action | How |
|------|------|
| Read a session | Expand a project in the sidebar → click a session |
| Expand details | Click a tool call (`▸ Bash …`) or a `Thinking` row |
| Resume / Fork | **Resume in terminal** / **Open as fork** buttons in the header |
| Narrow the list | `⌘F` — matches session titles, first prompts, and folder names |
| Search contents | `⌘K` — search field up top; `↑↓` to move, `↵` to open |
| Settings | `⌘,` or the ⚙ button — language, terminal, text size, updates |
| Delete Claude session | **Delete** button → confirm → moved to Trash |

## How your data is handled

- Reads Claude: `~/.claude/projects/<project>/<sessionId>.jsonl`
- Reads Codex: `$CODEX_HOME/sessions/**/*.jsonl` (`~/.codex` by default)
- Viewing is strictly read-only. Original files are never modified.
- The only write to your original files is Claude deletion you explicitly request — and even that moves files to the Trash. Codex transcripts and state databases are never modified.
- Settings are stored in the standard app data path (`userData/settings.json`).
- The content-search index lives at `userData/search-index.jsonl`. It holds only your prompts and the assistant's replies — never tool input or output — and never leaves your machine. Delete it and it rebuilds on the next launch.

## Known limitations

- Session JSONL uses internal formats of Claude Code and Codex. Rendering may vary by version; parsers skip unknown entries defensively.
- Claude subagent (sidechain) conversations are counted but not yet rendered.

## Codex support

Wake reads `$CODEX_HOME/sessions/**/*.jsonl` (`~/.codex` by default), groups sessions by their starting working directory, and labels each provider. Local sessions from both providers share repository groups and message search. Codex transcript parsing was checked against local `codex-cli 0.153.4` records and synthetic fixtures.

Codex rollouts are an internal format, not a stable public API. Unknown entries and damaged lines are skipped. Titles use the first user prompt; database-only names and pin state are not imported. Only stored readable reasoning summaries are shown. Archived sessions, cloud-only conversations, and separate app stores are not imported. Automated exec and subagent sessions follow the automated-session filter; parent/child relationships are not displayed. Wake never writes to Codex transcripts or its state database.

See [session provider design](docs/architecture/session-providers.md) for the official references and implementation decisions.


## Development

```bash
npm run dev        # dev mode with HMR
npm run typecheck  # type checking
npm run lint       # ESLint
npm run build      # typecheck + production build
```

Stack: Electron · electron-vite · React · TypeScript · react-markdown

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) and are enforced by commitlint.

## License

[MIT](LICENSE) © [followingseas](https://github.com/followingseas)
