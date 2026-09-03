#!/usr/bin/env python3
"""
Reset vertical conversion state for testing.

Deletes all files from data/clips/ (except .gitkeep) and resets VOD automation_state
back to 'pending' so the pipeline will re-process them.

Usage:
    python reset_vertical.py           # reset all VODs
    python reset_vertical.py --done    # only reset VODs in 'done' state (skip errors)
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).parent
CLIPS_DIR = ROOT / "data" / "clips"
VODS_FILE = ROOT / "data" / "twitch" / "vods.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--done", action="store_true", help="Only reset VODs with state 'done' (skip errors/processing)")
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen without doing it")
    args = parser.parse_args()

    # --- Delete all clips, vertical clips, and debug artifacts ---
    if CLIPS_DIR.exists():
        entries = sorted(
            e for e in CLIPS_DIR.iterdir()
            if e.name != ".gitkeep"
        )
        clip_files = [e for e in entries if e.is_file()]
        clip_dirs = [e for e in entries if e.is_dir()]

        if not entries:
            print("No clip files or directories found.")
        else:
            if clip_files:
                print(f"Deleting {len(clip_files)} file(s):")
                for f in clip_files:
                    print(f"  {f.name}")
                    if not args.dry_run:
                        f.unlink()

            if clip_dirs:
                print(f"Deleting {len(clip_dirs)} directory(s):")
                for d in clip_dirs:
                    file_count = sum(1 for _ in d.rglob("*") if _.is_file())
                    print(f"  {d.name}/ ({file_count} files)")
                    if not args.dry_run:
                        shutil.rmtree(d)

    # --- Reset VOD state ---
    if not VODS_FILE.exists():
        print(f"\nVODs file not found: {VODS_FILE}")
        sys.exit(1)

    with open(VODS_FILE) as fh:
        data = json.load(fh)

    reset_states = {"done", "error", "processing"} if not args.done else {"done"}
    reset_count = 0

    for vod in data.get("vods", []):
        state = vod.get("automation_state")
        if state in reset_states:
            print(f"\nResetting VOD {vod['id']} ({vod.get('channel_login', '?')}): {state!r} → 'pending'")
            if not args.dry_run:
                vod["automation_state"] = "pending"
                vod["vertical_clips"] = []
                vod["processed_at"] = None
                vod["automation_error"] = None
            reset_count += 1

    if reset_count == 0:
        print("\nNo VODs to reset.")
    elif not args.dry_run:
        with open(VODS_FILE, "w") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
        print(f"\nReset {reset_count} VOD(s). Run the pipeline to re-process.")
    else:
        print(f"\n[dry-run] Would reset {reset_count} VOD(s).")


if __name__ == "__main__":
    main()
