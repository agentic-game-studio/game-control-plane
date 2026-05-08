#!/usr/bin/env python3
"""
tilemap_split.py — Split a tileset image into individual tile images.

Takes a packed tileset image (e.g. 256x256 with 16x16 tiles = 16x16 grid)
and outputs individual .png files, one per tile, into a structured directory.

Usage:
  python3 tilemap_split.py \
    --input tileset.png \
    --output-dir ./split_tiles \
    --tile-width 16 --tile-height 16 \
    --margin 0 --spacing 0 \
    --pad 16 \
    --name-prefix "tile"

  # From presets.yaml entry:
  python3 tilemap_split.py --presets presets.yaml --job my_tileset_job

Output structure:
  split_tiles/
    tiles/
      tile_000.png   # row=0, col=0
      tile_001.png   # row=0, col=1
      ...
    atlas.json       # metadata for Godot TileSet / editor import
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow required. Run: pip install Pillow")
    sys.exit(1)


def split_tileset(
    img_path: Path,
    output_dir: Path,
    tile_w: int,
    tile_h: int,
    margin: int = 0,
    spacing: int = 0,
    pad: int = 0,
    name_prefix: str = "tile",
) -> dict:
    """
    Split a tileset image into individual tiles.

    Grid layout: tiles are laid out left-to-right, top-to-bottom.
    Optional padding (pad) centers each tile within a square cell.
    Margin: outer edge padding in the source image.
    Spacing: gap between tiles in the source image.
    """
    img = Image.open(img_path).convert("RGBA")
    img_w, img_h = img.width, img.height

    # Calculate grid dimensions
    inner_w = tile_w + spacing
    inner_h = tile_h + spacing
    cols = (img_w - 2 * margin - (img_w - 2 * margin) % inner_w) // inner_w
    rows = (img_h - 2 * margin - (img_h - 2 * margin) % inner_h) // inner_h
    cols = max(1, cols)
    rows = max(1, rows)

    tiles_dir = output_dir / "tiles"
    tiles_dir.mkdir(parents=True, exist_ok=True)

    atlas_entries = []
    tile_index = 0

    for row in range(rows):
        for col in range(cols):
            # Source pixel coordinates
            src_x = margin + col * inner_w
            src_y = margin + row * inner_h

            # Extract tile
            tile = img.crop((src_x, src_y, src_x + tile_w, src_y + tile_h))

            # Apply optional padding (center in square cell)
            if pad > 0:
                canvas = Image.new("RGBA", (pad, pad), (0, 0, 0, 0))
                offset_x = (pad - tile_w) // 2
                offset_y = (pad - tile_h) // 2
                canvas.paste(tile, (offset_x, offset_y))
                tile = canvas

            # Save tile
            tile_name = f"{name_prefix}_{tile_index:04d}.png"
            tile_path = tiles_dir / tile_name
            tile.save(tile_path, "PNG")

            atlas_entries.append({
                "index": tile_index,
                "row": row,
                "col": col,
                "name": tile_name,
                "path": str(tile_path.relative_to(output_dir)),
                "src_x": src_x,
                "src_y": src_y,
                "tile_w": tile_w,
                "tile_h": tile_h,
            })
            tile_index += 1

    # Write atlas metadata
    atlas = {
        "source": str(img_path),
        "tile_width": tile_w,
        "tile_height": tile_h,
        "margin": margin,
        "spacing": spacing,
        "pad": pad,
        "columns": cols,
        "rows": rows,
        "total_tiles": tile_index,
        "tiles": atlas_entries,
    }
    atlas_path = output_dir / "atlas.json"
    with open(atlas_path, "w") as f:
        json.dump(atlas, f, indent=2)

    return atlas


def main():
    parser = argparse.ArgumentParser(description="Split a tileset image into individual tile PNGs")
    parser.add_argument("--input", type=Path, help="Input tileset image (PNG)")
    parser.add_argument("--output-dir", type=Path, default=Path("./split_tiles"))
    parser.add_argument("--tile-width", type=int, default=16, help="Width of each tile in pixels")
    parser.add_argument("--tile-height", type=int, default=16, help="Height of each tile in pixels")
    parser.add_argument("--margin", type=int, default=0, help="Outer edge margin in source image")
    parser.add_argument("--spacing", type=int, default=0, help="Gap between tiles in source image")
    parser.add_argument("--pad", type=int, default=0, help="Pad each tile to a square size (e.g. 16 to pad to 16x16)")
    parser.add_argument("--name-prefix", default="tile", help="Prefix for tile filenames")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing files")

    args = parser.parse_args()

    if not args.input or not args.input.exists():
        print(f"ERROR: --input required and must exist: {args.input}")
        sys.exit(1)

    if args.dry_run:
        img = Image.open(args.input)
        print(f"[DRY-RUN] Would split {args.input} ({img.width}x{img.height})")
        print(f"  tile size: {args.tile_width}x{args.tile_height}")
        print(f"  margin: {args.margin}, spacing: {args.spacing}, pad: {args.pad}")
        return 0

    atlas = split_tileset(
        args.input,
        args.output_dir,
        args.tile_width,
        args.tile_height,
        args.margin,
        args.spacing,
        args.pad,
        args.name_prefix,
    )

    print(f"Done: split {atlas['source']} -> {atlas['total_tiles']} tiles")
    print(f"  Tiles: {args.output_dir / 'tiles'}")
    print(f"  Atlas: {args.output_dir / 'atlas.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
