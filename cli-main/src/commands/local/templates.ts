import {Flags} from '@oclif/core'
import {Command} from '@oclif/core'
import fs from 'node:fs'
import path from 'node:path'
import {findGodotBinary, getGodotVersion, runGodotHeadless} from '@cli/utils/local/godot-exec.js'

function getTemplateDir(): {baseDir: string; versionDir: string | null} {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const platform = process.platform

  let baseDir: string
  if (platform === 'darwin') {
    baseDir = path.join(home, 'Library', 'Application Support', 'Godot', 'export_templates')
  } else if (platform === 'win32') {
    baseDir = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Godot', 'export_templates')
  } else {
    baseDir = path.join(home, '.local', 'share', 'godot', 'export_templates')
  }

  const version = getGodotVersion()

  // Try exact version, then .stable suffix
  for (const suffix of ['', '.stable']) {
    const dir = path.join(baseDir, `${version}${suffix}`)
    if (fs.existsSync(dir)) return {baseDir, versionDir: dir}
  }

  // Scan for any directory matching major.minor
  if (fs.existsSync(baseDir)) {
    const majorMinor = version.split('.').slice(0, 2).join('.')
    for (const entry of fs.readdirSync(baseDir)) {
      if (entry.startsWith(majorMinor)) {
        return {baseDir, versionDir: path.join(baseDir, entry)}
      }
    }

    // Broader fallback: match any directory with the same major version
    // (handles init.ts hardcoding 4.3 when installed Godot is 4.6)
    const major = version.split('.')[0]
    for (const entry of fs.readdirSync(baseDir)) {
      if (entry.startsWith(`${major}.`) || entry === major) {
        return {baseDir, versionDir: path.join(baseDir, entry)}
      }
    }
  }

  return {baseDir, versionDir: null}
}

// Godot 4.x export template filenames follow the pattern:
// {platform}_{arch}_release[.ext]
const PLATFORM_PATTERNS: Record<string, RegExp[]> = {
  web: [
    /web_release\.zip$/i,
    /web\.zip$/i,
  ],
  windows: [
    /windows_x86_64_release\.exe$/i,
    /windows_x86_32_release\.exe$/i,
    /windows_release\.exe$/i,
  ],
  linux: [
    /linux_x86_64_release$/i,
    /linux_x86_32_release$/i,
    /linux_release$/i,
  ],
  macos: [
    /macos_release$/i,
    /macos\.framework/i,
    /macos\.app/i,
  ],
  android: [
    /android_release\.apk$/i,
    /android_release\.aab$/i,
    /^android_release$/i,
  ],
  ios: [
    /ios_release$/i,
  ],
}

export default class LocalTemplates extends Command {
  static override description = 'Check and install Godot export templates'

  static override examples = [
    '<%= config.bin %> local templates',
    '<%= config.bin %> local templates --install',
    '<%= config.bin %> local templates --json',
  ]

  static override flags = {
    json: Flags.boolean({description: 'Output as JSON'}),
    install: Flags.boolean({
      description: 'Install export templates by launching Godot editor briefly',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LocalTemplates)

    const projectGodot = path.join(process.cwd(), 'project.godot')
    if (!fs.existsSync(projectGodot)) {
      this.error('No Godot project detected (missing project.godot)', {exit: 1})
    }

    const version = getGodotVersion()
    const {baseDir, versionDir} = getTemplateDir()
    const templates = versionDir ? fs.readdirSync(versionDir).filter((f) => !f.startsWith('.')) : []

    const requiredPlatforms = ['web', 'windows', 'linux', 'macos', 'android', 'ios']
    const installed: string[] = []
    const missing: string[] = []

    for (const platform of requiredPlatforms) {
      const patterns = PLATFORM_PATTERNS[platform]
      const found = templates.some((t) => patterns.some((p) => p.test(t)))
      if (found) {
        installed.push(platform)
      } else {
        missing.push(platform)
      }
    }

    const status = missing.length === 0 ? 'complete' : installed.length === 0 ? 'missing' : 'partial'

    if (flags.install) {
      const godotBin = findGodotBinary()
      if (!godotBin) {
        this.error('Godot binary not found. Install Godot or set GODOT_BIN env var.', {exit: 1})
      }

      if (!flags.json) {
        this.log(`Installing export templates for Godot ${version}...`)
        this.log(`  Launching editor to trigger template download (may take a few minutes)...`)
      }

      // Launch editor briefly — Godot auto-downloads missing templates on startup
      // Note: --headless --editor may not trigger downloads on all platforms.
      // If this fails, templates must be installed manually via the editor GUI.
      const result = await runGodotHeadless({
        projectPath: process.cwd(),
        command: 'editor',
        timeout: 600_000,
      })

      // Re-check after install
      const {versionDir: newDir} = getTemplateDir()
      const newTemplates = newDir ? fs.readdirSync(newDir).filter((f) => !f.startsWith('.')) : []

      if (flags.json) {
        this.log(JSON.stringify({
          version,
          templateDir: newDir,
          status: newTemplates.length > 0 ? 'installed' : 'missing',
          templateCount: newTemplates.length,
          templates: newTemplates,
          elapsed_ms: result.elapsed_ms,
          ...(result.stderr ? {output: result.stderr} : {}),
        }, null, 2))
      } else {
        if (newTemplates.length > 0) {
          this.log(`Templates installed: ${newDir}`)
          this.log(`  Files: ${newTemplates.length}`)
        } else {
          this.log(`Template installation may have failed. Try manually:`)
          this.log(`  1. Open Godot editor`)
          this.log(`  2. Editor → Manage Export Templates → Install`)
          this.log(`  3. Or download from https://godotengine.org/download`)
        }
      }

      return
    }

    const output = {
      version,
      templateDir: versionDir,
      expectedDir: path.join(baseDir, version),
      status,
      installed,
      missing,
      templateCount: templates.length,
      templates,
    }

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
    } else {
      if (versionDir) {
        this.log(`Export templates for Godot ${version}:`)
        this.log(`  Location: ${versionDir}`)
        this.log(`  Status: ${status} (${installed.length}/${requiredPlatforms.length} platforms)`)
        this.log(`  Installed: ${installed.join(', ') || 'none'}`)
        this.log(`  Missing: ${missing.join(', ') || 'none'}`)
        this.log(`  Files: ${templates.length}`)
      } else {
        this.log(`No export templates found for Godot ${version}`)
        this.log(`  Expected at: ${path.join(baseDir, version)}`)
        this.log('')
        this.log(`Install options:`)
        this.log(`  ${this.config.bin} local templates --install`)
        this.log(`  Or: Godot Editor → Editor → Manage Export Templates → Download and Install`)
      }
    }
  }
}
