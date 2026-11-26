#!/usr/bin/env python3
"""Download media locally with yt-dlp + ffmpeg (no Cobalt/API server needed).

Usage:
  .venv/bin/python download.py <url>
  .venv/bin/python download.py <url> --audio
  .venv/bin/python download.py <url> --quality 720 --out ~/Movies
  .venv/bin/python download.py <url> --cookies-from-browser chrome
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

DEFAULT_OUT = Path(__file__).resolve().parent / "downloads"
MIN_VALID_BYTES = 1024  # anything smaller is treated as a failed download


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Download a video/audio link locally (yt-dlp, no server)"
    )
    p.add_argument("url", help="Media page URL (YouTube, TikTok, etc.)")
    p.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Output directory (default: {DEFAULT_OUT})",
    )
    p.add_argument(
        "--audio",
        action="store_true",
        help="Download audio only (mp3)",
    )
    p.add_argument(
        "--quality",
        default="1080",
        choices=["max", "4320", "2160", "1440", "1080", "720", "480", "360", "240", "144"],
        help="Max video height (default: 1080). Use max for best available.",
    )
    p.add_argument(
        "--format",
        default="mp3",
        choices=["mp3", "m4a", "opus", "wav", "flac"],
        help="Audio format when using --audio (default: mp3)",
    )
    p.add_argument(
        "--cookies-from-browser",
        metavar="BROWSER",
        help=(
            "Use cookies from a logged-in browser for age-restricted videos. "
            "Examples: chrome, chromium, brave, edge, firefox, safari"
        ),
    )
    p.add_argument(
        "--cookies",
        type=Path,
        help="Path to a cookies.txt file (Netscape format) instead of a browser",
    )
    return p.parse_args()


def video_format(quality: str) -> str:
    """Prefer real progressive/DASH mp4+m4a (avc1), not broken/empty streams."""
    height = "" if quality == "max" else f"[height<={quality}]"
    return (
        f"bv*{height}[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/"
        f"b{height}[ext=mp4]/"
        f"bv*{height}[protocol^=http]+ba[protocol^=http]/"
        f"bv*{height}+ba/b"
    )


def build_ydl_opts(args: argparse.Namespace, out_dir: Path) -> dict:
    outtmpl = str(out_dir / "%(title).200B [%(id)s].%(ext)s")

    # Node + remote EJS solver — without this, YouTube often yields empty files
    opts: dict = {
        "outtmpl": {"default": outtmpl},
        "noplaylist": True,
        "ignoreerrors": False,
        "retries": 10,
        "fragment_retries": 10,
        "concurrent_fragment_downloads": 1,
        "quiet": False,
        "no_warnings": False,
        "overwrites": True,
        "nopart": False,
        "continuedl": True,
        "js_runtimes": {"node": {}},
        "remote_components": {"ejs:github"},
        "progress_hooks": [progress_hook],
    }

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        opts["ffmpeg_location"] = str(Path(ffmpeg).parent)

    if args.cookies_from_browser:
        # yt-dlp accepts "chrome", "chrome:Profile 1", etc.
        browser = args.cookies_from_browser
        if ":" in browser:
            name, profile = browser.split(":", 1)
            opts["cookiesfrombrowser"] = (name, profile, None, None)
        else:
            opts["cookiesfrombrowser"] = (browser, None, None, None)
    elif args.cookies:
        opts["cookiefile"] = str(args.cookies.expanduser().resolve())

    if args.audio:
        opts.update(
            {
                "format": "bestaudio[ext=m4a]/bestaudio/best",
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": args.format,
                        "preferredquality": "192",
                    }
                ],
            }
        )
    else:
        opts.update(
            {
                "format": video_format(args.quality),
                "merge_output_format": "mp4",
                "postprocessors": [
                    {
                        "key": "FFmpegVideoRemuxer",
                        "preferedformat": "mp4",
                    }
                ],
            }
        )

    return opts


def progress_hook(d: dict) -> None:
    if d.get("status") == "downloading":
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        done = d.get("downloaded_bytes") or 0
        if total:
            pct = min(100.0, done * 100.0 / total)
            print(f"\r  {pct:5.1f}%  ({done}/{total} bytes)", end="", flush=True)
        else:
            print(f"\r  {done} bytes", end="", flush=True)
    elif d.get("status") == "finished":
        print("\n  Download finished, post-processing…")


def resolve_output_path(ydl, info: dict, audio_ext: str | None) -> Path | None:
    requested = info.get("requested_downloads") or []
    for item in requested:
        filepath = item.get("filepath")
        if filepath:
            path = Path(filepath)
            if audio_ext:
                candidate = path.with_suffix(f".{audio_ext}")
                if candidate.exists():
                    return candidate
            if path.exists():
                return path

    prepared = Path(ydl.prepare_filename(info))
    if audio_ext:
        candidate = prepared.with_suffix(f".{audio_ext}")
        if candidate.exists():
            return candidate
    if prepared.exists():
        return prepared

    # Last resort: newest non-empty file in the output folder matching the id
    video_id = info.get("id")
    out_dir = prepared.parent
    if video_id and out_dir.exists():
        matches = sorted(
            out_dir.glob(f"*[{video_id}].*"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for match in matches:
            if match.is_file() and match.stat().st_size > 0:
                return match
    return None


def main() -> int:
    args = parse_args()
    out_dir = args.out.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if not shutil.which("node"):
        print(
            "Node.js is required for YouTube downloads (JS challenges).\n"
            "Install Node, then retry.",
            file=sys.stderr,
        )
        return 1

    if not shutil.which("ffmpeg"):
        print(
            "ffmpeg is required to merge video+audio.\n"
            "Install ffmpeg, then retry.",
            file=sys.stderr,
        )
        return 1

    try:
        from yt_dlp import YoutubeDL
    except ImportError:
        print(
            "yt-dlp is not installed in the venv.\n"
            "  .venv/bin/pip install -r requirements.txt",
            file=sys.stderr,
        )
        return 1

    print(f"Downloading locally: {args.url}")
    print(f"Output folder: {out_dir}")

    opts = build_ydl_opts(args, out_dir)
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(args.url, download=True)
            if info is None:
                print("Download failed (no info returned).", file=sys.stderr)
                return 1
            if "entries" in info and info["entries"]:
                info = next((e for e in info["entries"] if e), None)
                if info is None:
                    print("Download failed (empty playlist).", file=sys.stderr)
                    return 1

            path = resolve_output_path(
                ydl, info, args.format if args.audio else None
            )
            if path is None or not path.exists():
                print("Download finished but output file was not found.", file=sys.stderr)
                return 1

            size = path.stat().st_size
            if size < MIN_VALID_BYTES:
                path.unlink(missing_ok=True)
                print(
                    f"Download produced an empty/corrupt file ({size} bytes) and was deleted.\n"
                    "This usually means YouTube blocked the format. Try again, or another URL.",
                    file=sys.stderr,
                )
                return 1

            print(f"Saved: {path} ({size:,} bytes)")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
