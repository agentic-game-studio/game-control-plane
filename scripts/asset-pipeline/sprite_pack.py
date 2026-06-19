#!/usr/bin/env python3
"""
sprite_pack.py — Pack individual sprite images into a sprite sheet.

Takes a directory of individual PNG frames (e.g. walk_000.png, walk_001.png...)
and arranges them into a rows×cols sprite sheet grid.

Usage:
  python3 sprite_pack.py \
    --input-dir ./frames \
    --output ./walk_sheet.png \
    --columns 4 \
    --padding 2 \
    --pad 32

  # Batch: pack each subdirectory as a separate animation
  python3 sprite_pack.py \
    --input-dir ./animations \
    --batch \
    --columns 4 \
    --pad 32

Output:
  walk_sheet.png           — packed sprite sheet
  walk_sheet.json          — metadata: { cols, rows, frame_w, frame_h, frames: [{row,col,name}] }
"""

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow required. Run: pip install Pillow")
    sys.exit(1)


def natural_sort_key(s: str) -> tuple:
    """Sort strings with embedded numbers numerically: walk_2.png < walk_10.png."""
    return tuple(int(m) if m.isdigit() else m.lower() for m in re.split(r'(\d+)', s))


def pack_sprites(
    input_dir: Path,
    output_path: Path,
    columns: int = 1,
    padding: int = 0,
    pad: int = 0,
) -> dict:
    """
    Pack all PNG files from input_dir into a sprite sheet.

    Args:
        input_dir: Directory containing .png frame files
        output_path: Output .png path
        columns: Number of columns in the sprite sheet grid
        padding: Pixel gap between frames in the sheet
        pad: Square cell size (frames are centered in pad×pad cells). 0 = no padding.

    Returns atlas dict.
    """
    frames = sorted(
        [f for f in input_dir.iterdir() if f.suffix.lower() == ".png"],
        key=lambda f: natural_sort_key(f.name),
    )
    if not frames:
        raise ValueError(f"No PNG frames found in {input_dir}")

    # Determine frame size from first image. `with` releases the source
    # file handle so a 100-frame pack doesn't leak 100 fds.
    with Image.open(frames[0]) as _src:
        frame_w, frame_h = _src.width, _src.height

    cell_w = max(frame_w, pad) if pad > 0 else frame_w
    cell_h = max(frame_h, pad) if pad > 0 else frame_h

    rows = (len(frames) + columns - 1) // columns
    sheet_w = columns * cell_w + (columns + 1) * padding
    sheet_h = rows * cell_h + (rows + 1) * padding

    sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
    atlas_entries = []

    for idx, frame_path in enumerate(frames):
        row = idx // columns
        col = idx % columns
        x = padding + col * (cell_w + padding)
        y = padding + row * (cell_h + padding)

        with Image.open(frame_path) as _src:
            img = _src.convert("RGBA").copy()

        # Center in cell if pad is set
        if pad > 0:
            canvas = Image.new("RGBA", (pad, pad), (0, 0, 0, 0))
            offset_x = (pad - img.width) // 2
            offset_y = (pad - img.height) // 2
            canvas.paste(img, (offset_x, offset_y))
            img = canvas

        sheet.paste(img, (x, y))

        atlas_entries.append({
            "index": idx,
            "name": frame_path.stem,
            "path": str(frame_path.relative_to(input_dir)),
            "row": row,
            "col": col,
            "x": x,
            "y": y,
        })

    sheet.save(output_path, "PNG")

    atlas = {
        "source_dir": str(input_dir),
        "output": str(output_path),
        "columns": columns,
        "rows": rows,
        "frame_w": frame_w,
        "frame_h": frame_h,
        "cell_w": cell_w,
        "cell_h": cell_h,
        "padding": padding,
        "pad": pad,
        "total_frames": len(frames),
        "frames": atlas_entries,
    }

    atlas_path = output_path.with_suffix(".json")
    with open(atlas_path, "w") as f:
        json.dump(atlas, f, indent=2)

    return atlas


def main():
    parser = argparse.ArgumentParser(description="Pack individual sprite frames into a sprite sheet")
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, help="Output .png path (for single pack)")
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--padding", type=int, default=0, help="Pixel gap between frames")
    parser.add_argument("--pad", type=int, default=0, help="Square cell size (0=no padding)")
    parser.add_argument("--batch", action="store_true", help="Pack each subdirectory as a separate sheet")
    parser.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()

    if not args.input_dir.exists():
        print(f"ERROR: {args.input_dir} does not exist")
        sys.exit(1)

    if args.batch:
        subdirs = [d for d in args.input_dir.iterdir() if d.is_dir()]
        if not subdirs:
            print(f"ERROR: --batch but no subdirectories found in {args.input_dir}")
            sys.exit(1)

        print(f"Batch: packing {len(subdirs)} animation directories")
        results = []
        for subdir in sorted(subdirs, key=lambda d: natural_sort_key(d.name)):
            frames = list(subdir.glob("*.png"))
            if not frames:
                print(f"  SKIP {subdir.name}/ — no PNG frames")
                continue
            output = args.input_dir / f"{subdir.name}_sheet.png"
            if args.dry_run:
                print(f"[DRY-RUN] Would pack {subdir.name}/ -> {output}")
                continue
            atlas = pack_sprites(subdir, output, args.columns, args.padding, args.pad)
            print(f"  Packed {subdir.name}/ -> {atlas['total_frames']} frames -> {output}")
            results.append(atlas)

        print(f"\nBatch complete: {len(results)} sheets packed")
        return 0

    else:
        if not args.output:
            print("ERROR: --output required for single pack")
            sys.exit(1)
        frames = list(args.input_dir.glob("*.png"))
        if not frames:
            print(f"ERROR: No PNG frames found in {args.input_dir}")
            sys.exit(1)

        if args.dry_run:
            print(f"[DRY-RUN] Would pack {len(frames)} frames from {args.input_dir} -> {args.output}")
            return 0

        atlas = pack_sprites(args.input_dir, args.output, args.columns, args.padding, args.pad)
        print(f"Done: {atlas['total_frames']} frames -> {args.output}")
        print(f"  Atlas: {args.output.with_suffix('.json')}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
