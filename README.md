# Out Past

Out Past is a calm, white, Claude-style focus and mission app for **macOS and
Windows**. It pulls your Google Calendars together, shows how much of your day
you actually used versus wasted, helps you set a north star and a mission, and
gives you a built-in AI mentor called **KAI** — one you can **talk to out loud**,
that **plans your week** and **fills your calendar** for you.

Built with Electron + React + Vite. Free, open source, and the AI runs fully on
your own machine.

## Download

| | |
|---|---|
| **Mac, Apple silicon** | [OutPast-Mac-AppleSilicon.dmg](https://github.com/kidus-tefeta/out-past/releases/latest/download/OutPast-Mac-AppleSilicon.dmg) |
| **Mac, Intel** | [OutPast-Mac-Intel.dmg](https://github.com/kidus-tefeta/out-past/releases/latest/download/OutPast-Mac-Intel.dmg) |
| **Windows** | [OutPast-Setup.exe](https://github.com/kidus-tefeta/out-past/releases/latest/download/OutPast-Setup.exe) |

KAI comes with it. The model is inside the download, so there is nothing to
install, no account, no key and no wifi needed.

Open the .dmg and drag Out Past to Applications. It is signed and notarized by
Apple, so it opens with no warning. On Windows the installer is not signed yet,
so SmartScreen shows "Windows protected your PC": press More info, then Run
anyway. One press installs it and puts Out Past on your desktop.

On a new machine KAI greets you out loud and walks you in: Google, your name and
north star, the hours you count as yours, then three short cards. It uses the
voice already in your machine, so there is nothing to download.

KAI's good morning screen and the mission week planner shown below are not in
this download yet. They land in the next release.

## Screenshots

**Good morning — KAI opens the day, out loud**

KAI greets you by name, names the mission and the week you are on, reads today's
tasks, and offers a time for anything not on the calendar yet. It speaks on the
machine, with no account and no key.

![KAI's good morning: the orb, the greeting and today's tasks](docs/screenshots/morning.png)

**KAI — talk to it, it plans and books your day**

![KAI](docs/screenshots/kai.png)

**Missions — set the goal, your work days and hours, and let KAI build the week**

![Mission](docs/screenshots/mission.png)

**Home — where your time is going**

![Home](docs/screenshots/home.png)

**Calendar — a calm, Notion-style day view**

![Calendar](docs/screenshots/calendar.png)

**Content — one great thing to watch, no feed, no rabbit hole**

![Content](docs/screenshots/content.png)

## KAI runs entirely on your device

KAI is a fully local AI mentor — you can **type or hold the mic and talk to it**,
and it **talks back**. It needs no API key, no account, and no internet:

- **Apple Intelligence** through a small bundled Swift helper (`build/afm`) on
  Apple silicon Macs running macOS 26+. Answers are instant and nothing leaves
  the machine.
- **A local ~2GB model via [Ollama](https://ollama.com)** (`qwen2.5:3b`) as the
  offline engine when Apple Intelligence is not available.
- **A local knowledge base** the app builds and reasons over itself, so KAI still
  answers usefully even when neither engine above is ready.
- **On-device speech**: hold the mic and speak — your voice is turned into text
  on your Mac (Apple's Speech framework, `build/stt`) and KAI reads its replies
  back through a local voice you pick. Nothing is sent to a server.

Everything KAI does happens on your machine.

## KAI does the work, not just the talk

KAI is an agent, not only a chat box:

- **Natural scheduling.** Say "read for three hours this afternoon and I wanna
  work out" and KAI turns it into real calendar blocks. Give an exact time
  ("meeting 5pm to 8pm") and it books it to the minute, no questions asked.
- **Missions.** Set one goal with a deadline, tap the **work days** you'll work
  it, set your **work hours** per day, and add **habits** (name + time) that drop
  onto your calendar every day automatically. Then **Plan with KAI** reads your
  strategy and packs each work day with tasks up to its hours — aiming past the
  target so a partial hit still clears it — and leaves your off days free.
- **The interview.** Tap **Interview me** and KAI asks the sharp questions —
  outcome and deadline, offer and price, who buys, your hours, your edge — then
  writes a measured brief (it even does the arithmetic) for the planner to run.

The model picks the tasks; the app does the day-and-time math, so your calendar
never drifts.

## What is not included

The blocking / "Lock In" enforcement engine (system-level focus locks and site
blocking) is **intentionally not part of this open source build**. The "Lock In"
tab is present as a placeholder so the rest of the app builds and runs unchanged.

## Windows

Out Past runs on Windows too. The UI, calendar, and KAI all work; the only
difference is the AI engine: there is no Apple Intelligence tier on Windows, so
KAI runs on the **Ollama ~2GB model plus the local knowledge base**. Install
[Ollama](https://ollama.com) and `ollama pull qwen2.5:3b` for the full local
mentor; without it KAI still answers from the knowledge base.

Build the Windows installer with `npm run build:win`, or let CI do it: the
included GitHub Actions workflow (`.github/workflows/build.yml`) builds the
`.exe` on a Windows runner. Run it from the Actions tab or by pushing a `v*`
tag, then download the installer from the run's artifacts. The installer is
unsigned, so Windows SmartScreen will warn on first launch (More info -> Run
anyway).

The blocking / Lock In enforcement engine is macOS-only and is not part of this
open build on any platform.

## Requirements

- macOS (Apple silicon recommended for the on-device Apple Intelligence engine)
  or Windows 10/11.
- Node 18+.
- A Google Cloud OAuth **Desktop** client (free) if you want calendar sync — you
  paste your own Client ID / Secret into the app on first run; they are stored
  locally and never bundled.

## Build and run

```bash
npm install

# Dev: Vite dev server + Electron with hot reload
npm run dev

# Build the renderer, then package the Mac app with electron-builder
npm run build

# Or just the unpacked .app (no dmg)
npm run pack
```

### Compiling the on-device helpers

The bundled binaries (`build/afm` for Apple Intelligence, `build/stt` for
on-device speech-to-text) are not committed. On Apple silicon running macOS 26+,
compile them from source before packaging:

```bash
# Apple Intelligence answers
swiftc build/afm.swift -O -target arm64-apple-macos26 -o build/afm

# On-device speech-to-text (hold-the-mic → text). Embeds its usage-string plist
# and is code-signed so macOS honors the microphone/speech prompts.
swiftc build/stt.swift -O -o build/stt \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker build/stt-info.plist
codesign -s - --force --options runtime build/stt
```

If either is missing or you are on an unsupported Mac, KAI skips that engine —
answers fall back to Ollama or the local knowledge base, and voice input falls
back to typing.

### Optional Ollama model

```bash
ollama pull qwen2.5:3b
```

With Ollama installed and running, KAI uses this ~2GB local model when Apple
Intelligence is unavailable. On Windows there is no Apple Intelligence tier, so
this model (plus the knowledge base) is what powers KAI.

## Optional cloud features

The core app and KAI are fully local. A couple of features (cross-device sync and
an optional cloud AI/scheduling worker) can be switched on by bringing your own
endpoints. Copy `.env.example` to `.env` and fill them in:

```bash
cp .env.example .env
```

Left blank, those features quietly disable themselves and everything else keeps
working. See `.env.example` for details.

## License

MIT. See [LICENSE](LICENSE).
