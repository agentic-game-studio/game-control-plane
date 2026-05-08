#!/usr/bin/env python3
"""
run_godot_headless.py — Spawn Godot in headless mode for CI/testing.

Usage:
  python3 run_godot_headless.py --project <path> --command <check|script|export> [options]

Commands:
  check     — godot --headless --check-only          : syntax validate all GDScripts
  script    — godot --headless --path <proj> --script <script.gd> : run a GDScript
  export    — godot --headless --path <proj> --export-release <preset> <output.pck> : export project
  gut      — godot --headless --path <proj> --test-runner              : run GUT tests

Returns JSON:
  { "success": bool, "returnCode": int, "stdout": str, "stderr": str, "elapsed_ms": int }
"""

import argparse
import json
import os
import subprocess
import sys
import time


def find_godot_binary() -> str | None:
    """Find godot binary using common paths and GODOT_BIN env var."""
    env_path = os.environ.get("GODOT_BIN")
    if env_path and os.path.isfile(env_path) and os.access(env_path, os.X_OK):
        return env_path

    search_paths = [
        "/usr/local/bin/godot",
        "/usr/bin/godot",
        os.path.expanduser("~/.local/bin/godot"),
        os.path.expanduser("~/.local/bin/godot4"),
        "/Applications/Godot.app/Contents/MacOS/Godot",
        "/Applications/Godot 4.app/Contents/MacOS/Godot",
    ]

    for p in search_paths:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p

    # Try which as last resort
    try:
        result = subprocess.run(["which", "godot"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            path = result.stdout.strip()
            if path and os.path.isfile(path):
                return path
    except Exception:
        pass

    return None


def run_godot(cmd: list[str], timeout: int = 120) -> dict:
    """Execute godot command, return structured result."""
    start = time.time()
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cmd[cmd.index("--path") + 1] if "--path" in cmd else None,
        )
        elapsed_ms = int((time.time() - start) * 1000)
        return {
            "success": proc.returncode == 0,
            "returnCode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "elapsed_ms": elapsed_ms,
        }
    except subprocess.TimeoutExpired:
        elapsed_ms = int((time.time() - start) * 1000)
        return {
            "success": False,
            "returnCode": -1,
            "stdout": "",
            "stderr": f"Command timed out after {timeout}s",
            "elapsed_ms": elapsed_ms,
        }
    except FileNotFoundError:
        return {
            "success": False,
            "returnCode": -2,
            "stdout": "",
            "stderr": "godot binary not found",
            "elapsed_ms": 0,
        }
    except Exception as exc:
        elapsed_ms = int((time.time() - start) * 1000)
        return {
            "success": False,
            "returnCode": -3,
            "stdout": "",
            "stderr": str(exc),
            "elapsed_ms": elapsed_ms,
        }


def cmd_boot(project_path: str, godot: str) -> dict:
    """Boot the project and exit cleanly — validates autoloads and scene load."""
    return run_godot(
        [godot, "--headless", "--path", project_path, "--quit"],
        timeout=60,
    )


def cmd_check(project_path: str, godot: str) -> dict:
    """Validate all GDScripts in project without running the scene."""
    return run_godot(
        [godot, "--headless", "--path", project_path, "--check-only"],
        timeout=120,
    )


def cmd_script(project_path: str, script_path: str, godot: str) -> dict:
    """Run a specific GDScript in headless mode."""
    return run_godot(
        [godot, "--headless", "--path", project_path, "--script", script_path],
        timeout=180,
    )


def cmd_export(project_path: str, preset: str, output: str, godot: str) -> dict:
    """Export project using export preset."""
    return run_godot(
        [godot, "--headless", "--path", project_path, "--export-release", preset, output],
        timeout=300,
    )


def cmd_gut(project_path: str, godot: str) -> dict:
    """Run GUT tests."""
    return run_godot(
        [godot, "--headless", "--path", project_path, "--test-runner"],
        timeout=300,
    )


def main():
    parser = argparse.ArgumentParser(description="Run Godot headless for CI")
    parser.add_argument("--project", required=True, help="Path to Godot project directory")
    parser.add_argument(
        "--command",
        required=True,
        choices=["check", "script", "export", "gut", "boot"],
        help="Command to run",
    )
    parser.add_argument("--script", help="Path to .gd script (for 'script' command)")
    parser.add_argument("--preset", help="Export preset name (for 'export' command)")
    parser.add_argument("--output", help="Output path (for 'export' command)")
    parser.add_argument("--godot-bin", help="Path to godot binary (default: auto-detect)")
    parser.add_argument("--timeout", type=int, default=120, help="Timeout in seconds")
    args = parser.parse_args()

    godot = args.godot_bin or find_godot_binary()
    if not godot:
        print(json.dumps({
            "success": False,
            "returnCode": -2,
            "stdout": "",
            "stderr": "godot binary not found. Set GODOT_BIN env var or install godot.",
            "elapsed_ms": 0,
        }))
        sys.exit(1)

    if args.command == "check":
        result = cmd_check(args.project, godot)
    elif args.command == "script":
        if not args.script:
            print(json.dumps({"success": False, "returnCode": -1, "stdout": "", "stderr": "--script required for 'script' command", "elapsed_ms": 0}))
            sys.exit(1)
        result = cmd_script(args.project, args.script, godot)
    elif args.command == "export":
        if not args.preset or not args.output:
            print(json.dumps({"success": False, "returnCode": -1, "stdout": "", "stderr": "--preset and --output required for 'export' command", "elapsed_ms": 0}))
            sys.exit(1)
        result = cmd_export(args.project, args.preset, args.output, godot)
    elif args.command == "gut":
        result = cmd_gut(args.project, godot)
    elif args.command == "boot":
        result = cmd_boot(args.project, godot)
    else:
        result = {"success": False, "returnCode": -1, "stdout": "", "stderr": f"Unknown command: {args.command}", "elapsed_ms": 0}

    print(json.dumps(result))
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
