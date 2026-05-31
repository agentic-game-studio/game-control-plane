import {Flags} from '@oclif/core'
import {Command} from '@oclif/core'
import {execFile} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {promisify} from 'node:util'
import {getProjectName} from '@cli/utils/local/godot-exec.js'

const execFileAsync = promisify(execFile)

function safeProjectName(): string {
  const sanitized = getProjectName().replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9_ .()-]/g, '')
  return sanitized.trim() || 'Game'
}
async function createMacOSDmg(appPath: string, outputPath: string, projectName: string): Promise<void> {
  const tmpDmg = outputPath.replace(/\.dmg$/, '_tmp.dmg')

  await execFileAsync('hdiutil', [
    'create', '-srcfolder', appPath, '-volname', projectName,
    '-filesystem', 'HFS+', '-format', 'UDRW', tmpDmg,
  ])

  await execFileAsync('hdiutil', [
    'convert', tmpDmg, '-format', 'UDZO', '-o', outputPath,
  ])

  if (fs.existsSync(tmpDmg)) fs.unlinkSync(tmpDmg)
}

async function createZip(buildDir: string, outputPath: string): Promise<void> {
  await execFileAsync('zip', ['-r', '-X', outputPath, '.'], {cwd: buildDir})
}

async function createTarball(buildDir: string, outputPath: string): Promise<void> {
  await execFileAsync('tar', ['-czf', outputPath, '-C', buildDir, '.'])
}

export default class LocalPackage extends Command {
  static override description = 'Package builds into distributable formats (.dmg, .zip, .tar.gz)'

  static override examples = [
    '<%= config.bin %> local package --platform macos',
    '<%= config.bin %> local package --platform windows',
    '<%= config.bin %> local package --platform linux',
    '<%= config.bin %> local package --platform web',
    '<%= config.bin %> local package --all --json',
  ]

  static override flags = {
    json: Flags.boolean({description: 'Output as JSON'}),
    platform: Flags.string({
      description: 'Platform to package: macos, windows, linux, web',
    }),
    all: Flags.boolean({
      description: 'Package all available platforms',
      default: false,
    }),
    output: Flags.string({
      description: 'Output file path (single platform only)',
      char: 'o',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LocalPackage)

    if (!flags.platform && !flags.all) {
      this.error('Specify --platform <macos|windows|linux|web> or --all', {exit: 1})
    }

    if (flags.all && flags.output) {
      this.error('Cannot use --output with --all', {exit: 1})
    }

    const projectGodot = path.join(process.cwd(), 'project.godot')
    if (!fs.existsSync(projectGodot)) {
      this.error('No Godot project detected (missing project.godot)', {exit: 1})
    }

    const projectName = safeProjectName()
    const buildsDir = path.join(process.cwd(), 'builds')

    if (!fs.existsSync(buildsDir)) {
      this.error('No builds directory found. Run "shipthis local build" first.', {exit: 1})
    }

    const platforms = flags.all
      ? ['macos', 'windows', 'linux', 'web']
      : [flags.platform!.toLowerCase()]

    const results = []

    for (const platform of platforms) {
      const start = Date.now()
      try {
        const result = await this.packagePlatform(platform, projectName, flags.output, flags.json)
        results.push({
          platform,
          success: true,
          ...result,
          elapsed_ms: Date.now() - start,
        })
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        results.push({
          platform,
          success: false,
          error: msg,
          elapsed_ms: Date.now() - start,
        })
      }
    }

    if (flags.json) {
      this.log(JSON.stringify(flags.all ? {packages: results} : results[0], null, 2))
    } else {
      for (const r of results) {
        if (r.success) {
          this.log(`  ✓ ${r.platform}: ${r.output} (${r.fileSizeMB} MB)`)
        } else {
          this.log(`  ✗ ${r.platform}: ${r.error}`)
        }
      }
    }

    const failed = results.filter((r) => !r.success)
    if (failed.length > 0) {
      this.error(`${failed.length}/${results.length} package(s) failed`, {exit: 1})
    }
  }

  private async packagePlatform(
    platform: string,
    projectName: string,
    outputFlag?: string,
    silent?: boolean,
  ): Promise<{output: string; fileSizeBytes: number; fileSizeMB: number}> {
    switch (platform) {
      case 'macos': return this.packageMacOS(projectName, outputFlag, silent)
      case 'windows': return this.packageWindows(projectName, outputFlag, silent)
      case 'linux': return this.packageLinux(projectName, outputFlag, silent)
      case 'web': return this.packageWeb(projectName, outputFlag, silent)
      default: throw new Error(`Packaging not supported for: ${platform}`)
    }
  }

  private async packageMacOS(projectName: string, outputFlag?: string, silent?: boolean): Promise<{output: string; fileSizeBytes: number; fileSizeMB: number}> {
    if (process.platform !== 'darwin') {
      throw new Error('macOS DMG packaging requires hdiutil, which is only available on macOS')
    }
    const appPath = path.join(process.cwd(), 'builds', 'macos', `${projectName}.app`)
    if (!fs.existsSync(appPath)) {
      throw new Error(`macOS .app not found at builds/macos/${projectName}.app. Run "shipthis local build --platform macos" first.`)
    }

    const outputPath = outputFlag ?? path.join(process.cwd(), 'builds', `${projectName}-macos.dmg`)

    if (!silent) this.log(`Creating macOS DMG: ${outputPath}...`)

    await createMacOSDmg(appPath, outputPath, projectName)

    const stat = fs.statSync(outputPath)
    return {
      output: outputPath,
      fileSizeBytes: stat.size,
      fileSizeMB: Math.round(stat.size / 1024 / 1024 * 100) / 100,
    }
  }

  private async packageWindows(projectName: string, outputFlag?: string, silent?: boolean): Promise<{output: string; fileSizeBytes: number; fileSizeMB: number}> {
    const buildDir = path.join(process.cwd(), 'builds', 'windows')
    if (!fs.existsSync(buildDir)) {
      throw new Error(`Windows build directory not found at builds/windows/. Run "shipthis local build --platform windows" first.`)
    }

    if (fs.readdirSync(buildDir).length === 0) {
      throw new Error(`Windows build directory is empty. Run "shipthis local build --platform windows" first.`)
    }

    const outputPath = outputFlag ?? path.join(process.cwd(), 'builds', `${projectName}-windows.zip`)

    if (!silent) this.log(`Creating Windows ZIP: ${outputPath}...`)

    await createZip(buildDir, outputPath)

    const stat = fs.statSync(outputPath)
    return {
      output: outputPath,
      fileSizeBytes: stat.size,
      fileSizeMB: Math.round(stat.size / 1024 / 1024 * 100) / 100,
    }
  }

  private async packageLinux(projectName: string, outputFlag?: string, silent?: boolean): Promise<{output: string; fileSizeBytes: number; fileSizeMB: number}> {
    const buildDir = path.join(process.cwd(), 'builds', 'linux')
    if (!fs.existsSync(buildDir)) {
      throw new Error(`Linux build directory not found at builds/linux/. Run "shipthis local build --platform linux" first.`)
    }

    if (fs.readdirSync(buildDir).length === 0) {
      throw new Error(`Linux build directory is empty. Run "shipthis local build --platform linux" first.`)
    }

    const outputPath = outputFlag ?? path.join(process.cwd(), 'builds', `${projectName}-linux.tar.gz`)

    if (!silent) this.log(`Creating Linux tarball: ${outputPath}...`)

    await createTarball(buildDir, outputPath)

    const stat = fs.statSync(outputPath)
    return {
      output: outputPath,
      fileSizeBytes: stat.size,
      fileSizeMB: Math.round(stat.size / 1024 / 1024 * 100) / 100,
    }
  }

  private async packageWeb(projectName: string, outputFlag?: string, silent?: boolean): Promise<{output: string; fileSizeBytes: number; fileSizeMB: number}> {
    const buildDir = path.join(process.cwd(), 'builds', 'web')
    if (!fs.existsSync(buildDir)) {
      throw new Error(`Web build directory not found at builds/web/. Run "shipthis local build --platform web" first.`)
    }

    if (fs.readdirSync(buildDir).length === 0) {
      throw new Error(`Web build directory is empty. Run "shipthis local build --platform web" first.`)
    }

    const outputPath = outputFlag ?? path.join(process.cwd(), 'builds', `${projectName}-web.zip`)

    if (!silent) this.log(`Creating Web ZIP: ${outputPath}...`)

    await createZip(buildDir, outputPath)

    const stat = fs.statSync(outputPath)
    return {
      output: outputPath,
      fileSizeBytes: stat.size,
      fileSizeMB: Math.round(stat.size / 1024 / 1024 * 100) / 100,
    }
  }
}
