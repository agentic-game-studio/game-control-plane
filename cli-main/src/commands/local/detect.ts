import {Flags} from '@oclif/core'
import {Command} from '@oclif/core'
import fs from 'node:fs'
import path from 'node:path'
import {findFilesRecursive, getGodotVersion, getProjectName} from '@cli/utils/local/godot-exec.js'

export default class LocalDetect extends Command {
  static override description = 'Detect and report Godot project info'

  static override examples = ['<%= config.bin %> local detect --json']

  static override flags = {
    json: Flags.boolean({description: 'Output as JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LocalDetect)
    const cwd = process.cwd()
    const projectGodot = path.join(cwd, 'project.godot')
    const isGodot = fs.existsSync(projectGodot)

    if (!isGodot) {
      const result = {isGodot: false, path: cwd}
      if (flags.json) {
        this.log(JSON.stringify(result, null, 2))
      } else {
        this.error('No Godot project detected (missing project.godot)', {exit: 1})
      }
      return
    }

    const name = getProjectName(cwd)
    const version = getGodotVersion(cwd)

    const exportPresetsPath = path.join(cwd, 'export_presets.cfg')
    const hasExportPresets = fs.existsSync(exportPresetsPath) && fs.statSync(exportPresetsPath).size > 0

    const scenes = findFilesRecursive(path.join(cwd, 'scenes'), ['.tscn'])
    const scripts = findFilesRecursive(path.join(cwd, 'scripts'), ['.gd'])

    const result = {
      isGodot: true,
      path: cwd,
      name,
      godotVersion: version,
      hasExportPresets,
      scenes: scenes.length,
      scripts: scripts.length,
      sceneFiles: scenes,
      scriptFiles: scripts,
    }

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
    } else {
      this.log(`Godot Project: ${name}`)
      this.log(`  Version: ${version}`)
      this.log(`  Export Presets: ${hasExportPresets ? 'found' : 'missing'}`)
      this.log(`  Scenes: ${scenes.length} (${scenes.join(', ') || 'none'})`)
      this.log(`  Scripts: ${scripts.length} (${scripts.join(', ') || 'none'})`)
    }
  }
}
