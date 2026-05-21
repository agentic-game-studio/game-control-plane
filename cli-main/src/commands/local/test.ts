import {Flags} from '@oclif/core'
import {Command} from '@oclif/core'
import fs from 'node:fs'
import path from 'node:path'
import {findGodotBinary, runGodotHeadless} from '@cli/utils/local/godot-exec.js'

export default class LocalTest extends Command {
  static override description = 'Run GUT tests via headless Godot'

  static override examples = ['<%= config.bin %> local test --json']

  static override flags = {
    json: Flags.boolean({description: 'Output as JSON'}),
    script: Flags.string({description: 'Path to specific test script'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LocalTest)

    const projectGodot = path.join(process.cwd(), 'project.godot')
    if (!fs.existsSync(projectGodot)) {
      this.error('No Godot project detected (missing project.godot)', {exit: 1})
    }

    const gutPath = path.join(process.cwd(), 'addons', 'gut', 'gut_cmdln.gd')
    if (!flags.script && !fs.existsSync(gutPath)) {
      this.error('GUT addon not found. Install GUT to addons/gut/ first.', {exit: 1})
    }

    const godotBin = findGodotBinary()
    if (!godotBin) {
      this.error('Godot binary not found. Install Godot or set GODOT_BIN env var.', {exit: 1})
    }

    if (!flags.json) {
      this.log('Running GUT tests...')
    }

    const result = await runGodotHeadless({
      projectPath: process.cwd(),
      command: flags.script ? 'script' : 'gut',
      script: flags.script,
      timeout: 300_000,
    })

    // Parse GUT output for test results
    const stdout = result.stdout
    const passMatch = stdout.match(/(\d+) passed/i)
    const failMatch = stdout.match(/(\d+) failed/i)
    const totalMatch = stdout.match(/(\d+) test/i)

    const testResult = {
      success: result.success,
      passed: passMatch ? parseInt(passMatch[1]) : 0,
      failed: failMatch ? parseInt(failMatch[1]) : 0,
      total: totalMatch ? parseInt(totalMatch[1]) : 0,
      elapsed_ms: result.elapsed_ms,
      returnCode: result.returnCode,
      stdout: stdout.slice(-2000), // Last 2000 chars
      ...(result.stderr ? {errors: result.stderr} : {}),
    }

    if (flags.json) {
      this.log(JSON.stringify(testResult, null, 2))
      if (!result.success && testResult.failed === 0 && testResult.total === 0) {
        this.error('Godot exited with errors but no test results were parsed (crash or GUT not configured)', {exit: 1})
      } else if (testResult.failed > 0) {
        this.error(`${testResult.failed} test(s) failed`, {exit: 1})
      }
    } else {
      this.log(`Tests: ${testResult.passed} passed, ${testResult.failed} failed (${Math.round(result.elapsed_ms / 1000)}s)`)
      if (!result.success && testResult.failed === 0 && testResult.total === 0) {
        this.error('Godot exited with errors but no test results were parsed (crash or GUT not configured)', {exit: 1})
      } else if (testResult.failed > 0) {
        this.error('Tests failed', {exit: 1})
      }
    }
  }
}
