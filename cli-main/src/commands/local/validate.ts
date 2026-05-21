import {Flags} from '@oclif/core'
import {Command} from '@oclif/core'
import fs from 'node:fs'
import path from 'node:path'
import {findFilesRecursive, findGodotBinary, getGodotVersion, getProjectName} from '@cli/utils/local/godot-exec.js'

interface ValidationCheck {
  name: string
  passed: boolean
  detail: string
  optional?: boolean
}

interface ValidationResult {
  valid: boolean
  checks: ValidationCheck[]
  errors: string[]
}

export default class LocalValidate extends Command {
  static override description = 'Full Godot project validation'

  static override examples = ['<%= config.bin %> local validate --json']

  static override flags = {
    json: Flags.boolean({description: 'Output as JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LocalValidate)
    const cwd = process.cwd()
    const checks: ValidationCheck[] = []
    const errors: string[] = []

    // Check 1: project.godot exists
    const projectGodot = path.join(cwd, 'project.godot')
    const hasProjectGodot = fs.existsSync(projectGodot)
    checks.push({name: 'project.godot', passed: hasProjectGodot, detail: hasProjectGodot ? 'found' : 'missing'})
    if (!hasProjectGodot) errors.push('Missing project.godot — not a Godot project')

    // Check 2: project.godot has valid config
    if (hasProjectGodot) {
      const projectName = getProjectName(cwd)
      const godotVersion = getGodotVersion(cwd)
      checks.push({name: 'project.godot valid', passed: true, detail: `${projectName} (${godotVersion})`})
    }

    // Check 3: export_presets.cfg exists and has valid content
    const exportPresetsPath = path.join(cwd, 'export_presets.cfg')
    const hasExportPresets = fs.existsSync(exportPresetsPath) && fs.statSync(exportPresetsPath).size > 0
    if (hasExportPresets) {
      const content = fs.readFileSync(exportPresetsPath, 'utf8')
      const presetCount = content.match(/\[preset\.\d+\]/g)?.length ?? 0
      checks.push({name: 'export_presets.cfg', passed: presetCount > 0, detail: `${presetCount} preset(s)`})
    } else {
      checks.push({name: 'export_presets.cfg', passed: false, detail: fs.existsSync(exportPresetsPath) ? 'empty file' : 'missing (run local export-presets)'})
    }

    // Check 4: scenes (recursive)
    const sceneFiles = findFilesRecursive(path.join(cwd, 'scenes'), ['.tscn'])
    checks.push({name: 'scenes', passed: sceneFiles.length > 0, detail: `${sceneFiles.length} scene file(s)`})

    // Check 5: main scene exists (read run/main_scene from project.godot)
    let mainScenePath = ''
    if (hasProjectGodot) {
      const config = fs.readFileSync(projectGodot, 'utf8')
      const mainSceneMatch = config.match(/run\/main_scene="([^"]+)"/)
      if (mainSceneMatch) {
        mainScenePath = path.join(cwd, mainSceneMatch[1].replace('res://', ''))
      }
    }
    if (!mainScenePath) mainScenePath = path.join(cwd, 'scenes', 'main.tscn')
    const hasMainScene = fs.existsSync(mainScenePath)
    checks.push({name: 'main scene', passed: hasMainScene, detail: hasMainScene ? `${path.relative(cwd, mainScenePath)} found` : 'missing'})

    // Check 6: scripts (recursive)
    const scriptFiles = findFilesRecursive(path.join(cwd, 'scripts'), ['.gd'])
    checks.push({name: 'scripts', passed: scriptFiles.length > 0, detail: `${scriptFiles.length} GDScript file(s)`})

    // Check 7: Godot binary available
    const godotBin = findGodotBinary()
    checks.push({name: 'godot binary', passed: !!godotBin, detail: godotBin || 'not found (set GODOT_BIN)'})

    // Check 8: .godot directory (build cache)
    const dotGodotDir = path.join(cwd, '.godot')
    checks.push({name: '.godot cache', passed: fs.existsSync(dotGodotDir), detail: fs.existsSync(dotGodotDir) ? 'present' : 'missing (will be created on first run)', optional: true})

    // Check 9: GUT addon (optional)
    const gutPath = path.join(cwd, 'addons', 'gut', 'gut_cmdln.gd')
    checks.push({name: 'GUT addon', passed: fs.existsSync(gutPath), detail: fs.existsSync(gutPath) ? 'installed' : 'not installed (optional for testing)', optional: true})

    const allPassed = checks.every((c) => c.passed || c.optional)

    const result: ValidationResult = {
      valid: allPassed,
      checks,
      errors,
    }

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
    } else {
      const icon = (passed: boolean) => passed ? '✓' : '✗'
      for (const check of checks) {
        this.log(`  ${icon(check.passed)} ${check.name}: ${check.detail}`)
      }
      this.log('')
      const failedCount = checks.filter((c) => !c.passed && !c.optional).length
      this.log(allPassed ? 'Project validation passed' : `Project has ${failedCount} issue(s)`)
    }
  }
}
