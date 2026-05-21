import {Flags} from '@oclif/core'
import {Command} from '@oclif/core'
import fs from 'node:fs'
import path from 'node:path'
import {findGodotBinary, getProjectName, runGodotHeadless} from '@cli/utils/local/godot-exec.js'

const PRESET_PLATFORM_MAP: Record<string, string> = {
  web: 'Web',
  windows: 'Windows Desktop',
  linux: 'Linux/X11',
  macos: 'macOS',
  android: 'Android',
  ios: 'iOS',
}

// Godot writes platform identifiers in export_presets.cfg that differ from preset names
// Our CLI writes "Windows Desktop" but Godot editor writes "Windows" — handle both
const GODOT_PLATFORM_ID: Record<string, string> = {
  Web: 'web',
  Windows: 'windows',
  'Windows Desktop': 'windows',
  'Linux/X11': 'linux',
  macOS: 'macos',
  Android: 'android',
  iOS: 'ios',
}

const PLATFORM_OUTPUT_PATHS: Record<string, string> = {
  web: 'builds/web/index.html',
  windows: 'builds/windows/{name}.exe',
  linux: 'builds/linux/{name}.x86_64',
  macos: 'builds/macos/{name}.app',
  android: 'builds/android/{name}.apk',
  ios: 'builds/ios/{name}.ipa',
}

function resolveOutputPath(platform: string, projectFlag?: string): string {
  if (projectFlag) return projectFlag
  const name = getProjectName().replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9_ .()-]/g, '').trim() || 'Game'
  const template = PLATFORM_OUTPUT_PATHS[platform] || `builds/${platform}/game.bin`
  return template.replace('{name}', name)
}

function listBuildArtifacts(outputPath: string): string[] {
  const artifacts: string[] = []
  const parentDir = path.dirname(outputPath)
  if (!fs.existsSync(parentDir)) return artifacts

  // For macOS .app, list the bundle contents summary
  if (outputPath.endsWith('.app') && fs.existsSync(outputPath)) {
    artifacts.push(outputPath)
    const contentsDir = path.join(outputPath, 'Contents')
    if (fs.existsSync(contentsDir)) {
      const macosDir = path.join(contentsDir, 'MacOS')
      if (fs.existsSync(macosDir)) {
        for (const f of fs.readdirSync(macosDir)) {
          artifacts.push(path.join(macosDir, f))
        }
      }

      const resourcesDir = path.join(contentsDir, 'Resources')
      if (fs.existsSync(resourcesDir)) {
        for (const f of fs.readdirSync(resourcesDir)) {
          artifacts.push(path.join(resourcesDir, f))
        }
      }

      const embeddedPck = path.join(contentsDir, 'embedded.pck')
      if (fs.existsSync(embeddedPck)) artifacts.push(embeddedPck)
    }

    return artifacts
  }

  // For web, list all files in the output directory
  if (outputPath.endsWith('.html')) {
    const webDir = path.dirname(outputPath)
    for (const f of fs.readdirSync(webDir)) {
      artifacts.push(path.join(webDir, f))
    }

    return artifacts
  }

  // For windows/linux/android/ios, list the output file + siblings
  if (fs.existsSync(outputPath)) artifacts.push(outputPath)

  // Check for .pck companion file
  const pckPath = outputPath.replace(/\.\w+$/, '.pck')
  if (fs.existsSync(pckPath)) artifacts.push(pckPath)

  // Check for debug symbols or console wrapper
  const dir = path.dirname(outputPath)
  for (const f of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, f)
    if (!artifacts.includes(fullPath)) artifacts.push(fullPath)
  }

  return artifacts
}

export default class LocalBuild extends Command {
  static override description = 'Run headless Godot export locally'

  static override examples = [
    '<%= config.bin %> local build --platform web',
    '<%= config.bin %> local build --platform macos --json',
    '<%= config.bin %> local build --platform windows --output builds/game.exe --json',
    '<%= config.bin %> local build --all',
    '<%= config.bin %> local build --all --json',
  ]

  static override flags = {
    json: Flags.boolean({description: 'Output as JSON'}),
    output: Flags.string({description: 'Output file path (single platform only)', char: 'o'}),
    platform: Flags.string({
      description: 'Target platform: web, windows, linux, macos, android, ios',
    }),
    all: Flags.boolean({
      description: 'Build all platforms defined in export_presets.cfg',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LocalBuild)

    if (!flags.platform && !flags.all) {
      this.error('Specify --platform <name> or --all', {exit: 1})
    }

    if (flags.all && flags.output) {
      this.error('Cannot use --output with --all (output paths are auto-resolved per platform)', {exit: 1})
    }

    const projectGodot = path.join(process.cwd(), 'project.godot')
    if (!fs.existsSync(projectGodot)) {
      this.error('No Godot project detected (missing project.godot)', {exit: 1})
    }

    const godotBin = findGodotBinary()
    if (!godotBin) {
      this.error('Godot binary not found. Install Godot or set GODOT_BIN env var.', {exit: 1})
    }

    const platforms = flags.all
      ? this.getPlatformsFromPresets()
      : [flags.platform!.toLowerCase()]

    if (platforms.length === 0) {
      this.error('No platforms to build. Create export_presets.cfg first or specify --platform.', {exit: 1})
    }

    const results = []

    for (const platform of platforms) {
      const presetName = PRESET_PLATFORM_MAP[platform]
      if (!presetName) {
        results.push({platform, success: false, errors: `Unknown platform: ${platform}`})
        continue
      }

      const outputPath = resolveOutputPath(platform, flags.output)

      // Ensure output directory exists
      const outputDir = path.dirname(outputPath)
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, {recursive: true})
      }

      if (!flags.json) {
        this.log(`Building ${platform} (${presetName})...`)
        this.log(`  Godot: ${godotBin}`)
        this.log(`  Output: ${outputPath}`)
      }

      const result = await runGodotHeadless({
        projectPath: process.cwd(),
        command: 'export',
        preset: presetName,
        output: outputPath,
        timeout: 600_000,
      })

      // Godot can exit 0 but produce no output (e.g., missing export templates).
      // Verify the output file actually exists before reporting success.
      const outputExists = result.success && fs.existsSync(outputPath)
      const effectiveSuccess = result.success && outputExists

      const artifacts = effectiveSuccess ? listBuildArtifacts(outputPath) : []
      let totalSize = 0
      for (const a of artifacts) {
        try {
          const stat = fs.statSync(a)
          if (stat.isFile()) totalSize += stat.size
        } catch { /* deleted between listing and sizing */ }
      }

      results.push({
        platform,
        preset: presetName,
        success: effectiveSuccess,
        output: outputPath,
        artifacts: artifacts.map((a) => path.relative(process.cwd(), a)),
        fileSizeBytes: totalSize,
        fileSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
        elapsed_ms: result.elapsed_ms,
        returnCode: result.returnCode,
        ...(result.stderr ? {errors: result.stderr} : {}),
        ...(result.success && !outputExists ? {errors: `Godot exited 0 but output file not found: ${outputPath}. Export templates may not be installed. Run "shipthis local templates --install".`} : {}),
      })
    }

    const failed = results.filter((r) => !r.success)

    if (flags.json) {
      this.log(JSON.stringify(flags.all ? {builds: results} : results[0], null, 2))
      if (failed.length > 0) {
        this.error(`${failed.length}/${results.length} build(s) failed`, {exit: 1})
      }
    } else {
      const succeeded = results.filter((r) => r.success)

      for (const r of succeeded) {
        this.log(`  ✓ ${r.platform}: ${r.output} (${r.fileSizeMB} MB, ${Math.round(r.elapsed_ms / 1000)}s)`)
        if (r.artifacts.length > 1) {
          this.log(`    Artifacts: ${r.artifacts.join(', ')}`)
        }
      }

      for (const r of failed) {
        this.log(`  ✗ ${r.platform}: ${r.errors || 'unknown error'}`)
      }

      if (failed.length > 0) {
        this.error(`${failed.length}/${results.length} build(s) failed`, {exit: 1})
      }
    }
  }

  private getPlatformsFromPresets(): string[] {
    const presetsPath = path.join(process.cwd(), 'export_presets.cfg')
    if (!fs.existsSync(presetsPath)) return []

    const content = fs.readFileSync(presetsPath, 'utf8')
    const platforms: string[] = []

    const matches = content.matchAll(/^platform="([^"]+)"/gm)
    for (const match of matches) {
      const cliName = GODOT_PLATFORM_ID[match[1]]
      if (cliName && !platforms.includes(cliName)) {
        platforms.push(cliName)
      }
    }

    return platforms
  }
}
