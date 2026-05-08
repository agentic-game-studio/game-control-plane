#!/usr/bin/env python3
"""
generate_audio.py — Procedural 2D game audio synthesis using only stdlib.

Generates retro/pixel-art style sound effects: jump, coin, shoot, hit, death,
powerup, levelup, menu_select, footstep. All synthesis uses Python's built-in
`wave` module — no external dependencies.

Usage:
  python3 generate_audio.py \
    --type jump \
    --output ./sfx/jump.wav \
    --duration 0.3

  # Batch from YAML
  python3 generate_audio.py --presets presets.yaml --output-dir ./sfx

Output: .wav files + manifest JSON.

Audio synthesis approach:
  - Jump: short pitch-up sine sweep
  - Coin/powerup: bright sine arpeggio
  - Shoot/explosion: noise burst with decay
  - Hit/damage: low-frequency noise impact
  - Death: descending pitch sweep
  - Menu/select: short click
  - Footstep: very short low thump
  - Levelup: ascending arpeggio fanfare
  - Ambient: filtered noise loop
"""

import argparse
import json
import math
import random
import struct
import sys
import wave
from pathlib import Path

SAMPLE_RATE = 22050
BIT_DEPTH = 16


# ─── Waveform generators ───────────────────────────────────────────────────────

def make_sine(freq: float, duration: float, volume: float = 0.8) -> bytes:
    n = int(SAMPLE_RATE * duration)
    frames = b"".join(
        struct.pack("<h", int(volume * 32767 * math.sin(2 * math.pi * freq * i / SAMPLE_RATE)))
        for i in range(n)
    )
    return frames


def make_sweep(start_freq: float, end_freq: float, duration: float, volume: float = 0.8) -> bytes:
    n = int(SAMPLE_RATE * duration)
    frames = b"".join(
        struct.pack(
            "<h",
            int(volume * 32767 * math.sin(2 * math.pi * (
                start_freq + (end_freq - start_freq) * i / n
            ) * i / SAMPLE_RATE))
        )
        for i in range(n)
    )
    return frames


def make_square(freq: float, duration: float, volume: float = 0.4) -> bytes:
    """Square wave for retro chip-tune feel."""
    n = int(SAMPLE_RATE * duration)
    half = SAMPLE_RATE / freq / 2
    frames = []
    for i in range(n):
        t = i % half
        val = volume if t < half / 2 else -volume
        frames.append(struct.pack("<h", int(val * 32767)))
    return b"".join(frames)


def make_noise(duration: float, volume: float = 0.5) -> bytes:
    n = int(SAMPLE_RATE * duration)
    frames = b"".join(
        struct.pack("<h", int(volume * 32767 * (random.random() * 2 - 1)))
        for _ in range(n)
    )
    return frames


def make_envelope(frames: bytes, attack: float, decay: float, sustain: float = 0.0) -> bytes:
    """Apply ADSR-style envelope to raw PCM frames."""
    n = len(frames) // 2  # 16-bit samples
    total = duration = n / SAMPLE_RATE
    attack_n = int(SAMPLE_RATE * attack)
    decay_n = int(SAMPLE_RATE * decay)
    sustain_n = max(0, n - attack_n - decay_n)

    result = []
    for i in range(n):
        if i < attack_n:
            env = i / max(1, attack_n)
        elif i < attack_n + decay_n:
            env = 1.0 - (1.0 - sustain) * ((i - attack_n) / max(1, decay_n))
        else:
            env = sustain
        sample = struct.unpack("<h", frames[i * 2 : i * 2 + 2])[0]
        result.append(struct.pack("<h", int(sample * env)))
    return b"".join(result)


def duration(dur: float) -> float:
    return dur


# ─── Per-type sound synthesizers ───────────────────────────────────────────────

def synth_jump(duration: float = 0.25) -> bytes:
    """Short upward pitch sweep."""
    return make_sweep(180, 600, duration, volume=0.7)


def synth_coin(duration: float = 0.35) -> bytes:
    """Two-tone bright chime."""
    f1 = make_sine(987, 0.08, 0.6)   # B5
    f2 = make_sine(1319, 0.12, 0.5)  # E6
    f3 = make_sine(1568, 0.2, 0.3)   # G6
    return f1 + f2 + f3


def synth_shoot(duration: float = 0.15) -> bytes:
    """Short noise burst."""
    return make_noise(duration, 0.5)


def synth_explosion(duration: float = 0.6) -> bytes:
    """Noise with pitch envelope."""
    noise = make_noise(duration, 0.6)
    sweep = make_sweep(150, 40, duration, 0.4)
    n_samples = len(noise) // 2
    s_samples = len(sweep) // 2
    # Mix
    mixed = b"".join(
        struct.pack(
            "<h",
            (struct.unpack("<h", noise[i*2:i*2+2])[0] + struct.unpack("<h", sweep[i*2:i*2+2])[0]) // 2
        )
        for i in range(min(n_samples, s_samples))
    )
    return make_envelope(mixed, 0.01, 0.3)


def synth_hit(duration: float = 0.2) -> bytes:
    """Low thud with quick decay."""
    return make_envelope(make_square(80, duration, 0.6), 0.005, 0.1)


def synth_death(duration: float = 0.8) -> bytes:
    """Descending pitch sweep."""
    return make_sweep(400, 50, duration, 0.7)


def synth_powerup(duration: float = 0.6) -> bytes:
    """Rising arpeggio."""
    notes = [(523, 0.07), (659, 0.07), (784, 0.07), (1047, 0.2)]
    out = b""
    for freq, dur in notes:
        out += make_sine(freq, dur, 0.6)
    return out


def synth_levelup(duration: float = 1.0) -> bytes:
    """Ascending fanfare."""
    arp = [(523, 0.1), (659, 0.1), (784, 0.1), (1047, 0.1), (1319, 0.5)]
    out = b""
    for freq, dur in arp:
        out += make_sine(freq, dur, 0.6)
    return out


def synth_menu_select(duration: float = 0.08) -> bytes:
    """Short click."""
    return make_square(440, duration, 0.3)


def synth_footstep(duration: float = 0.1) -> bytes:
    """Very short low thump."""
    return make_envelope(make_square(60, duration, 0.5), 0.005, 0.04)


def synth_menu_move(duration: float = 0.06) -> bytes:
    """Subtle tick for cursor move."""
    return make_square(660, duration, 0.2)


def synth_damage(duration: float = 0.3) -> bytes:
    """Sharp impact followed by rumble."""
    thud = make_envelope(make_square(90, 0.05, 0.7), 0.005, 0.05)
    rumble = make_sweep(120, 60, duration, 0.3)
    return thud + rumble


# ─── Registry ──────────────────────────────────────────────────────────────────

SYNTHS: dict[str, tuple[callable, float]] = {
    "jump":      (synth_jump,      0.25),
    "coin":      (synth_coin,      0.35),
    "shoot":     (synth_shoot,     0.15),
    "explosion": (synth_explosion, 0.60),
    "hit":       (synth_hit,       0.20),
    "death":     (synth_death,     0.80),
    "powerup":   (synth_powerup,   0.60),
    "levelup":   (synth_levelup,   1.00),
    "menu_select":  (synth_menu_select, 0.08),
    "menu_move":    (synth_menu_move,   0.06),
    "footstep":  (synth_footstep, 0.10),
    "damage":    (synth_damage,    0.30),
}

AUDIO_TYPES = list(SYNTHS.keys())


def generate_wav(synth_fn, duration: float, output_path: Path) -> dict:
    """Render a synthesizer function to a WAV file and return metadata."""
    raw = synth_fn(duration)
    with wave.open(str(output_path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)       # 16-bit
        w.setframerate(SAMPLE_RATE)
        w.writeframes(raw)

    size = output_path.stat().st_size
    return {
        "path": str(output_path),
        "type": "sfx",
        "size_bytes": size,
        "duration_s": duration,
        "sample_rate": SAMPLE_RATE,
        "channels": 1,
        "bit_depth": BIT_DEPTH,
    }


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Procedural 2D game audio synthesis")
    parser.add_argument("--type", choices=AUDIO_TYPES, help="Sound type to generate")
    parser.add_argument("--output", type=Path, help="Output .wav path")
    parser.add_argument("--duration", type=float, help="Override duration in seconds")
    parser.add_argument("--volume", type=float, default=0.8)
    parser.add_argument("--presets", type=Path, help="YAML batch preset file")
    parser.add_argument("--output-dir", type=Path, default=Path("./audio"), help="Batch output root")
    parser.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()

    # Load presets if given
    presets = []
    if args.presets:
        import yaml
        with open(args.presets) as f:
            data = yaml.safe_load(f)
        presets = data.get("audio_presets", data) if isinstance(data, dict) else data
    elif args.type and args.output:
        presets = [{"type": args.type, "output": args.output, "duration": args.duration}]
    else:
        parser.print_help()
        print(f"\nAvailable types: {', '.join(AUDIO_TYPES)}")
        return 0

    manifest = []
    for p in presets:
        sfx_type = p["type"]
        output = Path(p["output"])
        dur = p.get("duration") or SYNTHS[sfx_type][1]
        synth_fn, default_dur = SYNTHS[sfx_type]
        dur = dur or default_dur

        if args.dry_run:
            print(f"[DRY-RUN] Would generate {sfx_type} ({dur:.2f}s) -> {output}")
            continue

        output.parent.mkdir(parents=True, exist_ok=True)
        meta = generate_wav(synth_fn, dur, output)
        meta["name"] = output.stem
        meta["sfx_type"] = sfx_type
        manifest.append(meta)
        print(f"  Generated: {output} ({dur:.2f}s)")

    if manifest and not args.dry_run:
        manifest_path = args.output_dir / "audio-manifest.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)
        print(f"Manifest: {manifest_path} ({len(manifest)} sounds)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
