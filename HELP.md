# Help

## First-time setup

You need these installed:

- Docker Desktop (runs the Cobalt API)
- Python 3
- pnpm (runs the web UI)
- ffmpeg (merges video and audio): `brew install ffmpeg`

Then, from the project folder:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Start and stop

```bash
./start      # starts the Cobalt API (Docker) and the web UI
./stop       # stops the web UI and the Docker containers
```

Web UI: http://127.0.0.1:5173
API: http://localhost:9000/
Logs: `.run/web.log`

## Download a video

Run from the project folder, after `./start`:

```bash
.venv/bin/python download.py "https://youtube.com/live/xq4WDchNub8?feature=share" --quality 1080 --cookies-from-browser chrome
```

Files are saved to the `downloads/` folder.

## Options

| Option | Example | Meaning |
| --- | --- | --- |
| `--quality` | `--quality 720` | Max video height: `max`, `4320`, `2160`, `1440`, `1080` (default), `720`, `480`, `360`, `240`, `144` |
| `--audio` | `--audio` | Audio only, saved as mp3 |
| `--format` | `--audio --format m4a` | Audio format with `--audio`: `mp3` (default), `m4a`, `opus`, `wav`, `flac` |
| `--out` | `--out ~/Movies` | Save to a different folder |
| `--cookies-from-browser` | `--cookies-from-browser chrome` | Use a logged-in browser's cookies (for age-restricted or members-only videos). Also: `chromium`, `brave`, `edge`, `firefox`, `safari` |
| `--cookies` | `--cookies cookies.txt` | Use a Netscape-format cookies.txt file instead of a browser |

Examples:

```bash
.venv/bin/python download.py "<url>" --audio
.venv/bin/python download.py "<url>" --quality 720 --out ~/Movies
.venv/bin/python download.py "<url>" --quality max
```

## Troubleshooting

- **`./start` says the API did not become ready:** make sure Docker Desktop is running, then try again.
- **Web UI fails to start:** check `.run/web.log`.
- **Age-restricted video fails:** log in to YouTube in the browser you pass to `--cookies-from-browser`, then retry.
- **Stale process after a crash:** run `./stop`, then `./start`.
