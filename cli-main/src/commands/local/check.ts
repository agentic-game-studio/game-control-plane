import {Flags} from '@oclif/core'
import {Command} from '@oclif/core'
import fs from 'node:fs'
import path from 'node:path'
import {findGodotBinary, runGodotHeadless} from '@cli/utils/local/godot-exec.js'

export default class LocalCheck extends Command {
  static override description = 'Validate GDScripts via headless Godot'

  static override examples = ['<%= config.bin %> local check --json']

  static override flags = {
    json: Flags.boolean({description: 'Output as JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LocalCheck)

    const projectGodot = path.join(process.cwd(), 'project.godot')
    if (!fs.existsSync(projectGodot)) {
      this.error('No Godot project detected (missing project.godot)', {exit: 1})
    }

    const godotBin = findGodotBinary()
    if (!godotBin) {
      this.error('Godot binary not found. Install Godot or set GODOT_BIN env var.', {exit: 1})
    }

    if (!flags.json) {
      this.log(`Checking scripts...`)
    }

    const result = await runGodotHeadless({
      projectPath: process.cwd(),
      command: 'check',
      timeout: 120_000,
    })

    // Parse errors — match lines with error indicators referencing script or scene files
    const errorLines = result.stderr
      .split('\n')
      .filter((l) => {
        const upper = l.toUpperCase()
        return (upper.includes('ERROR') || upper.includes('SCRIPT ERROR')) && (l.includes('.gd') || l.includes('.tscn'))
      })

    const checkResult = {
      success: result.success,
      elapsed_ms: result.elapsed_ms,
      returnCode: result.returnCode,
      errorCount: errorLines.length,
      errors: errorLines,
      ...(result.stderr && !result.success && errorLines.length === 0 ? {rawStderr: result.stderr.slice(-500)} : {}),
    }

    if (flags.json) {
      this.log(JSON.stringify(checkResult, null, 2))
      if (!result.success || errorLines.length > 0) {
        this.error(errorLines.length > 0 ? `${errorLines.length} script error(s) found` : `Godot exited with code ${result.returnCode}`, {exit: 1})
      }
    } else {
      if (result.success && errorLines.length === 0) {
        this.log(`All scripts valid (${Math.round(result.elapsed_ms / 1000)}s)`)
      } else if (errorLines.length > 0) {
        this.log(`Found ${errorLines.length} script error(s):`)
        for (const line of errorLines) {
          this.log(`  ${line}`)
        }
        this.error('Script validation failed', {exit: 1})
      } else {
        this.log(`Godot exited with code ${result.returnCode} but no parseable script errors found.`)
        this.log(`  stderr: ${result.stderr.slice(-300)}`)
        this.error('Script validation failed (unparseable output)', {exit: 1})
      }
    }
  }
}
