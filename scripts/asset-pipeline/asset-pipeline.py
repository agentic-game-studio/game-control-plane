#!/usr/bin/env python3
"""
Game Asset Generation Pipeline for game-control-plane.

Steps:
  1. Generate image with mflux-generate-flux2 (FLUX2 Klein on Apple Silicon)
  2. Remove background with rembg (U2-Net saliency)
  3. Post-process: pad to grid, alpha-trim, smart sprite-sheet auto-slice
  4. Generate thumbnail (128x128)
  5. Write Godot .import override file (Nearest filter for pixel art)
  6. Organize into Godot-friendly directory structure
  7. Emit JSON manifest for the asset inventory API

Usage:
  # Single asset from CLI flags
  python asset-pipeline.py \
    --prompt "magic health potion bottle, red glowing liquid" \
    --type 2d --category ui --width 512 --height 512 --steps 4 \
    --output-dir ../../workspace/godot-test-1/assets

  # Batch from presets YAML
  python asset-pipeline.py \
    --presets presets.yaml \
    --output-dir ../../workspace/godot-test-1/assets

  # Dry-run (preview commands without executing)
  python asset-pipeline.py --presets presets.yaml --dry-run
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional, Tuple, List

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow required. pip install pillow")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class AssetPreset:
    """A single asset generation job definition."""
    name: str
    prompt: str
    type: str = "2d"           # 2d | 3d | vfx | audio | texture
    category: str = "prop"     # prop | character | env | weapon | ui | tex | sfx | music
    width: int = 512
    height: int = 512
    steps: int = 4
    seed: Optional[int] = None
    remove_bg: bool = True
    negative_prompt: Optional[str] = None
    model: str = "flux2-klein-4b"
    quantize: Optional[int] = None
    # Sprite-sheet options
    sprite_sheet: bool = False
    sprite_cols: int = 1
    sprite_rows: int = 1
    # Grid padding (for centering in Godot tile size)
    grid_size: Optional[int] = None   # e.g. 128 for 128x128 tiles
    tags: list = field(default_factory=list)


@dataclass
class PipelineResult:
    """Output of a single pipeline run."""
    name: str
    status: str                    # "success" | "error"
    raw_path: Optional[str] = None
    processed_path: Optional[str] = None
    thumbnail_path: Optional[str] = None
    manifest_entry: Optional[dict] = None
    error: Optional[str] = None
    elapsed_seconds: float = 0.0


# ---------------------------------------------------------------------------
# Step 1 — Generate with mflux
# ---------------------------------------------------------------------------

def generate_mflux(preset: AssetPreset, output_dir: Path, dry_run: bool = False,
                   gen_timeout: int = 600) -> Path:
    """Run mflux-generate-flux2 and return the output image path."""
    slug = re.sub(r'[^a-z0-9]+', '_', preset.name.lower()).strip('_')
    raw_path = output_dir / "raw" / f"{slug}.png"

    if dry_run:
        print(f"  [DRY-RUN] would generate: {raw_path}")
        return raw_path

    raw_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "mflux-generate-flux2",
        "--prompt", preset.prompt,
        "--steps", str(preset.steps),
        "--width", str(preset.width),
        "--height", str(preset.height),
        "--output", str(raw_path),
        "--model", preset.model,
    ]

    if preset.seed is not None:
        cmd.extend(["--seed", str(preset.seed)])
    if preset.negative_prompt:
        cmd.extend(["--negative-prompt", preset.negative_prompt])
    if preset.quantize:
        cmd.extend(["--quantize", str(preset.quantize)])

    print(f"  [mflux] generating {preset.name} ({preset.width}x{preset.height}, {preset.steps} steps)...")
    t0 = time.time()
    # 6J-6th: handle subprocess.TimeoutExpired explicitly. Without it, a
    # hung mflux process would raise a bare exception with no elapsed
    # time and no cleanup; the surrounding `for preset in presets:` loop
    # would die on the first hang and the whole batch run would abort
    # mid-pipeline. Timeout is a known, recoverable failure (mflux is
    # Apple-Silicon ML and the first generation in a session can run
    # several minutes past the wall-clock budget on cold cache).
    try:
        # 28-M-asset-pipeline-gen-timeout: use the CLI flag instead
        # of the hardcoded 600s.
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=gen_timeout)
    except subprocess.TimeoutExpired as exc:
        elapsed = time.time() - t0
        # 29-L-asset-pipeline-full-cmd-on-fail: previous shape
        # printed `cmd[:3]` + "..." which truncated away the
        # distinguishing args (the seed, the negative-prompt, the
        # output path). Two failed runs with the same model and
        # first 3 args were indistinguishable. The full command
        # contains no secrets (just prompt text + paths) and is
        # what an operator needs to reproduce the failure.
        raise RuntimeError(
            f"mflux timed out after {exc.timeout}s (elapsed {elapsed:.1f}s) — "
            f"command: {' '.join(cmd)}"
        ) from exc
    elapsed = time.time() - t0

    if result.returncode != 0:
        raise RuntimeError(f"mflux failed (exit {result.returncode}): {result.stderr[:500]}")

    print(f"  [mflux] done in {elapsed:.1f}s -> {raw_path}")
    return raw_path


# ---------------------------------------------------------------------------
# Step 2 — Remove background
# ---------------------------------------------------------------------------

def remove_background(input_path: Path, output_path: Path, dry_run: bool = False) -> Path:
    """Use rembg CLI to strip the background and produce a transparent PNG."""
    if dry_run:
        print(f"  [DRY-RUN] would remove bg: {input_path} -> {output_path}")
        return output_path

    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        from rembg import remove
        with open(input_path, "rb") as f:
            input_bytes = f.read()
        output_bytes = remove(input_bytes)
        with open(output_path, "wb") as f:
            f.write(output_bytes)
        print(f"  [rembg] bg removed -> {output_path}")
        return output_path
    except ImportError:
        print("  [rembg] not available, falling back to PIL alpha extraction")
        # Fallback: convert white/flat backgrounds to transparent. The
        # `with` block releases the underlying file handle once we've
        # finished reading; without it, a long fallback run leaks fds
        # the same way the main path did.
        with Image.open(input_path) as _src:
            img = _src.convert("RGBA").copy()
        datas = img.getdata()
        new_data = []
        for item in datas:
            # Make near-white pixels transparent
            if item[0] > 240 and item[1] > 240 and item[2] > 240:
                new_data.append((255, 255, 255, 0))
            else:
                new_data.append(item)
        img.putdata(new_data)
        img.save(output_path, "PNG")
        print(f"  [fallback] simple white->transparent -> {output_path}")
        return output_path


# ---------------------------------------------------------------------------
# Helper — Smart sprite bounding-box detection
# ---------------------------------------------------------------------------

def detect_sprite_bounding_boxes(
    img: Image.Image,
    alpha_threshold: int = 10,
    min_gap: int = 2,
    padding: int = 2,
) -> Optional[List[Tuple[int, int, int, int]]]:
    """
    Detect individual sprites in a sprite-sheet by scanning for content gaps
    in the alpha channel.

    Algorithm:
      1. Extract the alpha channel from the RGBA image.
      2. For every row, check if any pixel has alpha >= alpha_threshold.
      3. For every column, check if any pixel has alpha >= alpha_threshold.
      4. Find horizontal gaps (consecutive empty rows >= min_gap) and
         vertical gaps (consecutive empty columns >= min_gap).
      5. Split at the midpoints of those gaps to produce bounding boxes.
      6. Add padding around each box, clamped to image bounds.

    Returns a list of (x, y, w, h) bounding boxes, or None if detection
    fails (e.g. no gaps found → single sprite or uniform sheet).
    """
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    w, h = img.size
    alpha = img.split()[3]

    # Build per-row and per-column content masks
    row_has_content = []
    for y in range(h):
        row_pixels = alpha.crop((0, y, w, y + 1)).getdata()
        has_content = any(p >= alpha_threshold for p in row_pixels)
        row_has_content.append(has_content)

    col_has_content = []
    for x in range(w):
        col_pixels = alpha.crop((x, 0, x + 1, h)).getdata()
        has_content = any(p >= alpha_threshold for p in col_pixels)
        col_has_content.append(has_content)

    # Find split points (midpoints of gaps) in each axis
    def find_split_points(has_content_list, min_gap_size):
        """Return indices at which to split (middle of each detected gap)."""
        gaps = []
        in_gap = False
        gap_start = 0
        for i, has in enumerate(has_content_list):
            if not has:
                if not in_gap:
                    in_gap = True
                    gap_start = i
            else:
                if in_gap:
                    gap_len = i - gap_start
                    if gap_len >= min_gap_size:
                        gaps.append((gap_start, i - 1))
                    in_gap = False
        # Handle trailing gap
        if in_gap:
            gap_len = len(has_content_list) - gap_start
            if gap_len >= min_gap_size:
                gaps.append((gap_start, len(has_content_list) - 1))

        # Return the midpoint + 1 of each gap as the split coordinate
        return [(g_start + g_end) // 2 + 1 for g_start, g_end in gaps]

    h_splits = find_split_points(row_has_content, min_gap)
    v_splits = find_split_points(col_has_content, min_gap)

    # If no gaps detected in either direction, fall back
    if not h_splits and not v_splits:
        return None

    # Build row ranges and column ranges from split points
    def ranges_from_splits(splits, length):
        if splits:
            ranges = []
            prev = 0
            for sp in splits:
                ranges.append((prev, sp))
                prev = sp
            ranges.append((prev, length))
            return ranges
        return [(0, length)]

    row_ranges = ranges_from_splits(h_splits, h)
    col_ranges = ranges_from_splits(v_splits, w)

    # Generate bounding boxes from the grid of row/col ranges
    boxes = []
    for r_start, r_end in row_ranges:
        for c_start, c_end in col_ranges:
            # Apply padding, clamped to image bounds
            x0 = max(0, c_start - padding)
            y0 = max(0, r_start - padding)
            x1 = min(w, c_end + padding)
            y1 = min(h, r_end + padding)
            bw = x1 - x0
            bh = y1 - y0
            if bw > 0 and bh > 0:
                boxes.append((x0, y0, bw, bh))

    # If only one box resulted, detection didn't meaningfully split anything
    if len(boxes) <= 1:
        return None

    return boxes


# ---------------------------------------------------------------------------
# Helper — Thumbnail generation
# ---------------------------------------------------------------------------

def generate_thumbnail(
    img: Image.Image,
    output_dir: Path,
    slug: str,
    size: int = 128,
) -> Path:
    """
    Generate a 128x128 thumbnail of the image and save it in the
    thumbnails/ directory.  Returns the path to the saved thumbnail.
    """
    thumb_dir = output_dir / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    thumb_path = thumb_dir / f"{slug}_thumb.png"

    thumb = img.copy()
    thumb.thumbnail((size, size), Image.LANCZOS)

    # Centre the (potentially non-square) thumbnail on a size×size canvas
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset_x = (size - thumb.width) // 2
    offset_y = (size - thumb.height) // 2
    canvas.paste(thumb, (offset_x, offset_y))
    canvas.save(thumb_path, "PNG")

    print(f"  [thumb] {size}x{size} thumbnail -> {thumb_path}")
    return thumb_path


# ---------------------------------------------------------------------------
# Helper — Godot .import file generation
# ---------------------------------------------------------------------------

def write_godot_import_file(
    asset_path: Path,
    category: str,
    dry_run: bool = False,
) -> Path:
    """
    Create a Godot .import override file next to the asset.

    Configures Nearest-neighbour texture filtering (no blur on scaling),
    which is essential for pixel art and stylised 2D assets.

    Returns the path to the .import file.
    """
    import_path = asset_path.with_suffix(asset_path.suffix + ".import")

    if dry_run:
        print(f"  [DRY-RUN] would write Godot .import: {import_path}")
        return import_path

    filename = asset_path.name
    # Godot builds the cache path from an MD5 of the resource path
    res_path = f"res://assets/{category}/{filename}"
    md5_hash = hashlib.md5(res_path.encode("utf-8")).hexdigest()

    content = f"""\
[remap]

importer="texture"
type="CompressedTexture2D"
path="res://.godot/imported/{filename}-{md5_hash}.ctex"

[deps]

source_file="{res_path}"

[params]

compress/mode=0
compress/high_quality=false
compress/lossy_quality=0.7
compress/hdr_compression=1
compress/normal_map=0
compress/channel_pack=0
mipmaps/generate=false
mipmaps/limit=-1
roughness/mode=0
roughness/src_normal=""
process/fix_alpha_border=true
process/premult_alpha=false
process/normal_map_invert_y=false
process/hdr_as_srgb=false
process/hdr_clamp_exposure=false
process/size_limit=0
detect_3d/compress_to=0
texture_filter/negative_src=0
texture_filter/s=true
"""

    with open(import_path, "w") as f:
        f.write(content)

    print(f"  [godot] .import file -> {import_path}")
    return import_path


# ---------------------------------------------------------------------------
# Step 3 — Post-processing
# ---------------------------------------------------------------------------

def post_process(
    img_path: Path,
    output_dir: Path,
    preset: AssetPreset,
    dry_run: bool = False,
) -> Tuple[Path, Optional[Path]]:
    """
    Apply post-processing: alpha-trim, grid-pad, smart sprite-sheet slice,
    thumbnail generation, and Godot .import file creation.

    Returns (final_path, thumbnail_path).
    """
    slug = re.sub(r'[^a-z0-9]+', '_', preset.name.lower()).strip('_')

    if dry_run:
        final = output_dir / preset.category / f"{slug}.png"
        thumb = output_dir / "thumbnails" / f"{slug}_thumb.png"
        print(f"  [DRY-RUN] would post-process -> {final}")
        print(f"  [DRY-RUN] would generate thumbnail -> {thumb}")
        print(f"  [DRY-RUN] would write Godot .import -> {final}.import")
        return final, thumb

    # 6J-6th: Image.open() returns a lazy file handle. Without `with`, the
    # handle stays open until the image is garbage-collected (Pillow holds
    # it internally until .load() is called). In a long batch run that
    # opens 100+ images per preset, file descriptors accumulate until
    # `OSError: [Errno 24] Too many open files`. The `with` block calls
    # .close() on exit even if the subsequent crop / paste / save raises.
    with Image.open(img_path) as _src:
        img = _src.convert("RGBA").copy()

    # 3a. Alpha-trim (crop to content bounding box)
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    # 3b. Grid padding — center the sprite within a target tile size
    if preset.grid_size:
        gs = preset.grid_size
        canvas = Image.new("RGBA", (gs, gs), (0, 0, 0, 0))
        # Scale down if larger than grid
        if img.width > gs or img.height > gs:
            img.thumbnail((gs, gs), Image.LANCZOS)
        offset_x = (gs - img.width) // 2
        offset_y = (gs - img.height) // 2
        canvas.paste(img, (offset_x, offset_y))
        img = canvas

    # 3c. Save final
    category_dir = output_dir / preset.category
    category_dir.mkdir(parents=True, exist_ok=True)
    final_path = category_dir / f"{slug}.png"
    img.save(final_path, "PNG")
    print(f"  [post] final asset -> {final_path} ({img.width}x{img.height})")

    # 3d. Sprite-sheet auto-slice (if flagged)
    if preset.sprite_sheet and (preset.sprite_cols > 1 or preset.sprite_rows > 1):
        slice_dir = output_dir / preset.category / f"{slug}_frames"
        slice_dir.mkdir(parents=True, exist_ok=True)

        # Try smart bounding-box detection first
        boxes = detect_sprite_bounding_boxes(img)
        if boxes:
            print(f"  [slice] smart detection found {len(boxes)} sprites")
            idx = 0
            for (bx, by, bw, bh) in boxes:
                frame = img.crop((bx, by, bx + bw, by + bh))
                frame_path = slice_dir / f"{slug}_frame_{idx:03d}.png"
                frame.save(frame_path, "PNG")
                idx += 1
            print(f"  [slice] {idx} frames (smart) -> {slice_dir}")
        else:
            # Fall back to grid-based slicing
            print(f"  [slice] smart detection found no gaps, falling back to grid")
            frame_w = img.width // preset.sprite_cols
            frame_h = img.height // preset.sprite_rows
            idx = 0
            for row in range(preset.sprite_rows):
                for col in range(preset.sprite_cols):
                    frame = img.crop((
                        col * frame_w, row * frame_h,
                        (col + 1) * frame_w, (row + 1) * frame_h,
                    ))
                    frame_path = slice_dir / f"{slug}_frame_{idx:03d}.png"
                    frame.save(frame_path, "PNG")
                    idx += 1
            print(f"  [slice] {idx} frames (grid fallback) -> {slice_dir}")

    # 3e. Generate thumbnail
    thumbnail_path = generate_thumbnail(img, output_dir, slug)

    # 3f. Write Godot .import file
    write_godot_import_file(final_path, preset.category, dry_run)

    return final_path, thumbnail_path


# ---------------------------------------------------------------------------
# Step 4 — Manifest generation
# ---------------------------------------------------------------------------

def _make_relative(path: Path, base: Path) -> str:
    """Make *path* relative to *base*, falling back to the full string."""
    try:
        return str(path.relative_to(base))
    except ValueError:
        return str(path)


def build_manifest_entry(
    preset: AssetPreset,
    final_path: Path,
    raw_path: Path,
    output_dir: Path,
    thumbnail_path: Optional[Path] = None,
    workspace_dir: Optional[Path] = None,
) -> dict:
    """Build a JSON-serializable manifest entry matching GameAsset schema.

    Paths (path, rawPath, thumbnailPath) are stored relative to *workspace_dir*
    when provided, otherwise relative to *output_dir*.  The thumbnail-serving
    route resolves from WORKSPACE_DIR, so using workspace_dir ensures the
    paths are always resolvable regardless of which caller invoked the pipeline.
    """
    rel_base = workspace_dir if workspace_dir else output_dir
    stat = final_path.stat() if final_path.exists() else None
    return {
        "id": f"asset-{int(time.time()*1000)}-{re.sub(r'[^a-z0-9]+', '-', preset.name.lower())}",
        "filename": final_path.name,
        "type": preset.type,
        "category": preset.category,
        "sizeBytes": stat.st_size if stat else 0,
        # 29-L-asset-pipeline-manifest-tag-dup: previous shape
        # appended `preset.type` and `preset.category` to the
        # user-defined tags. Both are already first-class fields on
        # the manifest entry above — adding them to `tags` was
        # duplicated data that the inventory API then had to dedup
        # when filtering. Drop the duplicates.
        "tags": list(preset.tags),
        "generatedWith": {
            "tool": "mflux-generate-flux2",
            "model": preset.model,
            "prompt": preset.prompt,
            "width": preset.width,
            "height": preset.height,
            "steps": preset.steps,
            "seed": preset.seed,
            "negativePrompt": preset.negative_prompt,
        },
        "path": _make_relative(final_path, rel_base),
        "rawPath": _make_relative(raw_path, rel_base),
        "thumbnailPath": _make_relative(thumbnail_path, rel_base) if thumbnail_path else None,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


# ---------------------------------------------------------------------------
# Main pipeline orchestrator
# ---------------------------------------------------------------------------

def run_pipeline(preset: AssetPreset, output_dir: Path, dry_run: bool = False,
                 workspace_dir: Optional[Path] = None,
                 gen_timeout: int = 600) -> PipelineResult:
    """Execute the full asset generation pipeline for one preset."""
    t0 = time.time()
    try:
        # Step 1: Generate
        raw_path = generate_mflux(preset, output_dir, dry_run, gen_timeout=gen_timeout)

        # Step 2: Remove background
        slug = re.sub(r'[^a-z0-9]+', '_', preset.name.lower()).strip('_')
        processed_dir = output_dir / "processed"
        processed_dir.mkdir(parents=True, exist_ok=True)
        bg_removed_path = processed_dir / f"{slug}_nobg.png"

        if preset.remove_bg:
            remove_background(raw_path, bg_removed_path, dry_run)
            source_for_post = bg_removed_path
        else:
            source_for_post = raw_path

        # Step 3: Post-process (returns final_path and thumbnail_path)
        final_path, thumbnail_path = post_process(source_for_post, output_dir, preset, dry_run)

        # Step 4: Manifest
        manifest = build_manifest_entry(
            preset, final_path, raw_path, output_dir, thumbnail_path,
            workspace_dir=workspace_dir,
        ) if not dry_run else None

        elapsed = time.time() - t0
        return PipelineResult(
            name=preset.name,
            status="success",
            raw_path=str(raw_path),
            processed_path=str(final_path),
            thumbnail_path=str(thumbnail_path) if thumbnail_path else None,
            manifest_entry=manifest,
            elapsed_seconds=elapsed,
        )
    except Exception as e:
        elapsed = time.time() - t0
        return PipelineResult(
            name=preset.name,
            status="error",
            error=str(e),
            elapsed_seconds=elapsed,
        )


# ---------------------------------------------------------------------------
# Batch from presets YAML
# ---------------------------------------------------------------------------

def load_presets(yaml_path: Path) -> list[AssetPreset]:
    """Load asset presets from a YAML file."""
    # 13-M-asset-pipeline: dropped the JSON-with-comments fallback. The
    # fallback would only work on YAML files that happened to be valid
    # JSON — multi-doc YAML, anchors, and YAML lists broke silently.
    # PyYAML is in the standard asset-pipeline dep set; if a user
    # doesn't have it, we want a loud error, not a garbled parse.
    try:
        import yaml
    except ImportError as e:
        raise RuntimeError(
            "PyYAML is required to load presets. Install with `pip install pyyaml`."
        ) from e

    with open(yaml_path) as f:
        data = yaml.safe_load(f)

    presets = data.get("presets", data) if isinstance(data, dict) else data
    return [AssetPreset(**p) for p in presets]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Game Asset Generation Pipeline")
    parser.add_argument("--prompt", help="Image generation prompt")
    parser.add_argument("--name", help="Asset name (slug-safe)", default="untitled_asset")
    parser.add_argument("--type", default="2d", choices=["2d", "3d", "vfx", "audio", "texture"])
    parser.add_argument("--category", default="prop", choices=["prop", "character", "env", "weapon", "ui", "tex", "sfx", "music"])
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--steps", type=int, default=4)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--no-remove-bg", dest="remove_bg", action="store_false")
    parser.add_argument("--negative-prompt", default=None)
    parser.add_argument("--model", default="flux2-klein-4b")
    parser.add_argument("--quantize", type=int, default=None)
    parser.add_argument("--grid-size", type=int, default=None, help="Pad to this tile size (e.g. 128)")
    parser.add_argument("--sprite-sheet", action="store_true")
    parser.add_argument("--sprite-cols", type=int, default=1)
    parser.add_argument("--sprite-rows", type=int, default=1)
    parser.add_argument("--tags", nargs="*", default=[])
    parser.add_argument("--presets", help="YAML file with batch presets")
    # 28-M-asset-pipeline-gen-timeout: was hardcoded to 600s. A
    # warm-cache second generation finishes in ~30s but would still
    # block for the full 10 minutes on a hang. Make it a CLI flag
    # so callers can tune per environment.
    parser.add_argument("--gen-timeout", type=int, default=600, help="Per-asset mflux subprocess timeout (seconds)")
    parser.add_argument("--output-dir", default=".", help="Output root directory")
    parser.add_argument("--workspace-dir", default=None,
                        help="Workspace root dir — manifest paths are stored relative to this")
    parser.add_argument("--dry-run", action="store_true", help="Preview without executing")
    parser.add_argument("--manifest-only", action="store_true", help="Skip generation, only rebuild manifest from existing files")
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    workspace_dir = Path(args.workspace_dir).resolve() if args.workspace_dir else None

    # Build presets list
    if args.presets:
        presets = load_presets(Path(args.presets))
        print(f"Loaded {len(presets)} presets from {args.presets}")
    elif args.prompt:
        presets = [AssetPreset(
            name=args.name,
            prompt=args.prompt,
            type=args.type,
            category=args.category,
            width=args.width,
            height=args.height,
            steps=args.steps,
            seed=args.seed,
            remove_bg=args.remove_bg,
            negative_prompt=args.negative_prompt,
            model=args.model,
            quantize=args.quantize,
            grid_size=args.grid_size,
            sprite_sheet=args.sprite_sheet,
            sprite_cols=args.sprite_cols,
            sprite_rows=args.sprite_rows,
            tags=args.tags,
        )]
    else:
        parser.error("Either --prompt or --presets is required")

    # Run pipeline
    results: list[PipelineResult] = []
    manifest_entries: list[dict] = []

    print(f"\n{'='*60}")
    print(f" Asset Pipeline: {len(presets)} job(s)")
    print(f" Output: {output_dir}")
    print(f" Dry-run: {args.dry_run}")
    print(f"{'='*60}\n")

    for i, preset in enumerate(presets, 1):
        print(f"[{i}/{len(presets)}] {preset.name}")
        result = run_pipeline(preset, output_dir, args.dry_run,
                              workspace_dir=workspace_dir, gen_timeout=args.gen_timeout)
        results.append(result)
        if result.manifest_entry:
            manifest_entries.append(result.manifest_entry)
        print(f"  -> {result.status} ({result.elapsed_seconds:.1f}s)\n")

    # Write manifest
    if manifest_entries and not args.dry_run:
        manifest_path = output_dir / "asset-manifest.json"
        # Merge with existing manifest if present
        existing = []
        if manifest_path.exists():
            try:
                with open(manifest_path) as f:
                    existing = json.load(f)
            except (json.JSONDecodeError, IOError):
                pass

        existing_ids = {e["id"] for e in existing}
        for entry in manifest_entries:
            if entry["id"] not in existing_ids:
                existing.append(entry)

        # C10: write atomically (tmp + rename) so a kill -9 / power loss
        # mid-write can't leave a half-written manifest. os.replace is
        # atomic on POSIX and Windows (Python 3.3+).
        tmp_manifest = manifest_path.with_suffix(manifest_path.suffix + ".tmp")
        with open(tmp_manifest, "w") as f:
            json.dump(existing, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_manifest, manifest_path)
        print(f"Manifest updated: {manifest_path} ({len(existing)} total assets)")

    # Summary
    ok = sum(1 for r in results if r.status == "success")
    err = sum(1 for r in results if r.status == "error")
    print(f"\n{'='*60}")
    print(f" Done: {ok} success, {err} error, {len(results)} total")
    print(f"{'='*60}")

    if err > 0:
        for r in results:
            if r.status == "error":
                print(f"  FAIL: {r.name} - {r.error}")

    return 0 if err == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
