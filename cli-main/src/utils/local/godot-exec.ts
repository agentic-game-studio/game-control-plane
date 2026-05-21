import {execFile, execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {promisify} from 'node:util'

const execFileAsync = promisify(execFile)

const GODOT_BINARY_PATHS = [
  process.env.GODOT_BIN,
  '/usr/local/bin/godot',
  '/usr/bin/godot',
  path.join(process.env.HOME || process.env.USERPROFILE || '/', '.local/bin/godot'),
  path.join(process.env.HOME || process.env.USERPROFILE || '/', '.local/bin/godot4'),
  '/Applications/Godot.app/Contents/MacOS/Godot',
  '/Applications/Godot 4.app/Contents/MacOS/Godot',
  '/snap/bin/godot',
].filter(Boolean) as string[]

export function findGodotBinary(): string | null {
  for (const candidate of GODOT_BINARY_PATHS) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

export function getProjectName(projectPath?: string): string {
  try {
    const content = fs.readFileSync(path.join(projectPath ?? process.cwd(), 'project.godot'), 'utf8')
    const match = content.match(/config\/name="([^"]+)"/)
    return match ? match[1] : 'Game'
  } catch { return 'Game' }
}

export function getGodotVersion(projectPath?: string): string {
  try {
    const content = fs.readFileSync(path.join(projectPath ?? process.cwd(), 'project.godot'), 'utf8')
    const match = content.match(/config\/features=PackedStringArray\(([^)]+)\)/)
    if (match) return match[1].replace(/"/g, '').split(',')[0]
  } catch { /* ignore */ }
  return '4.3'
}

export function getInstalledGodotVersion(): string | null {
  const bin = findGodotBinary()
  if (!bin) return null
  try {
    const result = execFileSync(bin, ['--version'], {timeout: 10_000, encoding: 'utf8'})
    const raw = result.trim().split('\n')[0]
    if (!raw.startsWith('4.')) return null
    const parts = raw.split('.')
    if (parts.length < 2) return null
    return `${parts[0]}.${parts[1]}`  // e.g. "4.6"
  } catch { return null }
}

export function findFilesRecursive(dir: string, extensions: string[], rootDir?: string): string[] {
  if (!fs.existsSync(dir)) return []
  const root = rootDir ?? dir
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(path.join(dir, entry.name), extensions, root))
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(path.relative(root, path.join(dir, entry.name)))
    }
  }
  return results
}

export interface GodotExecResult {
  success: boolean
  returnCode: number | null
  stdout: string
  stderr: string
  elapsed_ms: number
}

export interface GodotExecOptions {
  projectPath: string
  command: 'boot' | 'check' | 'export' | 'script' | 'gut' | 'editor'
  preset?: string
  output?: string
  script?: string
  timeout?: number
}

export async function runGodotHeadless(options: GodotExecOptions): Promise<GodotExecResult> {
  const godotBin = findGodotBinary()
  if (!godotBin) {
    return {
      success: false,
      returnCode: null,
      stdout: '',
      stderr: 'Godot binary not found. Install Godot or set GODOT_BIN env var.',
      elapsed_ms: 0,
    }
  }

  const args = ['--headless', '--path', options.projectPath]
  switch (options.command) {
    case 'boot':
      args.push('--quit')
      break
    case 'check':
      args.push('--check-only')
      break
    case 'export':
      if (!options.preset || !options.output) {
        return {success: false, returnCode: null, stdout: '', stderr: 'preset and output required for export', elapsed_ms: 0}
      }
      args.push('--export-release', options.preset, options.output)
      break
    case 'script':
      if (!options.script) {
        return {success: false, returnCode: null, stdout: '', stderr: 'script required for script command', elapsed_ms: 0}
      }
      args.push('--script', options.script)
      break
    case 'gut':
      args.push('-s', 'addons/gut/gut_cmdln.gd')
      break
    case 'editor':
      args.push('--editor', '--quit-after', '2')
      break
  }

  const start = Date.now()
  try {
    const {stdout, stderr} = await execFileAsync(godotBin, args, {
      timeout: options.timeout ?? 300_000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return {
      success: true,
      returnCode: 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      elapsed_ms: Date.now() - start,
    }
  } catch (err: unknown) {
    const e = err as {code?: string; killed?: boolean; stdout?: string; stderr?: string; message?: string; status?: number}
    const isTimeout = e.killed === true || e.code === 'ETIMEDOUT'
    return {
      success: false,
      returnCode: isTimeout ? null : (e.status ?? 1),
      stdout: (e.stdout ?? '').trim(),
      stderr: isTimeout ? `Godot process timed out after ${Math.round((options.timeout ?? 300_000) / 1000)}s` : (e.stderr ?? e.message ?? '').trim(),
      elapsed_ms: Date.now() - start,
    }
  }
}
