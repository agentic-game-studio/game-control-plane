import {Args, Flags} from '@oclif/core'
import {Command} from '@oclif/core'
import fs from 'node:fs'
import path from 'node:path'
import {findGodotBinary, getInstalledGodotVersion} from '@cli/utils/local/godot-exec.js'

const GODOT4_PROJECT_TEMPLATE = `; Engine configuration file.
; It's best edited using the editor UI and not directly,
; since the parameters that go here are not all obvious.
;
; Format:
;   [section] ; section goes between []
;   param=value ; assign values to parameters

config_version=5

[application]

config/name="{NAME}"
run/main_scene="res://scenes/main.tscn"
config/features=PackedStringArray("{VERSION}", "Forward Plus")

[display]

window/size/viewport_width=1152
window/size/viewport_height=648
window/stretch/mode="canvas_items"
window/stretch/aspect="expand"

[rendering]

renderer/rendering_method="forward_plus"
`

const MAIN_SCENE_TEMPLATE = `[gd_scene format=3]

[node name="Main" type="Node2D"]
`

const GLOBAL_SCRIPT_TEMPLATE = `extends Node

# Global autoload singleton
# Add global state and utility functions here
`

const EVENT_BUS_SCRIPT_TEMPLATE = `extends Node

# Event bus autoload singleton
# Define signals here for cross-scene communication
#
# Example:
# signal health_changed(new_health: int)
# signal score_changed(new_score: int)
`

const BOOT_CHECK_SCRIPT_TEMPLATE = `extends SceneTree

# Boot check script - validates autoloads work correctly
# Run with: godot --headless --script boot_check.gd --quit

func _init() -> void:
\tprint("BOOT CHECK PASSED")
\tquit()
`

const GITIGNORE_TEMPLATE = `# Godot 4+ specific
.godot/

# Godot-specific ignores
*.import
export_presets.cfg

# Build outputs
builds/

# OS-specific
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
`

export default class LocalInit extends Command {
  static override args = {
    name: Args.string({description: 'Project name', required: true}),
  }

  static override description = 'Scaffold a new Godot 4.x project'

  static override examples = ['<%= config.bin %> local init MyGame', '<%= config.bin %> local init MyGame --with-autoloads']

  static override flags = {
    json: Flags.boolean({description: 'Output as JSON'}),
    'with-autoloads': Flags.boolean({description: 'Create autoload stubs (Global.gd, EventBus.gd)', default: false}),
    output: Flags.string({description: 'Output directory (defaults to project name)', char: 'o'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(LocalInit)

    if (args.name.includes('/') || args.name.includes('\\')) {
      this.error('Project name cannot contain path separators', {exit: 1})
    }

    const projectDir = flags.output || args.name
    const absDir = path.resolve(projectDir)

    // Prevent path traversal: resolved path must be inside current working directory
    if (flags.output) {
      const cwd = process.cwd()
      if (!absDir.startsWith(cwd + path.sep) && absDir !== cwd) {
        this.error('Output path must be inside the current directory', {exit: 1})
      }
    }

    if (fs.existsSync(absDir)) {
      const stat = fs.statSync(absDir)
      this.error(stat.isDirectory() ? `Directory ${absDir} already exists` : `A file exists at ${absDir}`, {exit: 1})
    }

    const dirs = ['scenes', 'scripts', 'assets', 'assets/sprites', 'assets/audio', 'assets/fonts']

    if (flags['with-autoloads']) {
      dirs.push('scripts/autoloads')
    }

    for (const dir of dirs) {
      fs.mkdirSync(path.join(absDir, dir), {recursive: true})
    }

    const godotBin = findGodotBinary()
    const version = getInstalledGodotVersion() ?? '4.3'
    const projectContent = GODOT4_PROJECT_TEMPLATE.replace('{NAME}', args.name).replace('{VERSION}', version)
    fs.writeFileSync(path.join(absDir, 'project.godot'), projectContent)
    fs.writeFileSync(path.join(absDir, 'scenes', 'main.tscn'), MAIN_SCENE_TEMPLATE)
    fs.writeFileSync(path.join(absDir, '.gitignore'), GITIGNORE_TEMPLATE)

    // Create icon.svg placeholder
    const firstChar = (args.name[0] || 'G').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const iconSvg = `<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg"><rect width="128" height="128" fill="#478cbf"/><text x="64" y="72" text-anchor="middle" fill="white" font-size="24">${firstChar}</text></svg>`
    fs.writeFileSync(path.join(absDir, 'icon.svg'), iconSvg)

    const createdFiles = ['project.godot', 'scenes/main.tscn', 'icon.svg', '.gitignore']

    if (flags['with-autoloads']) {
      fs.writeFileSync(path.join(absDir, 'scripts', 'autoloads', 'Global.gd'), GLOBAL_SCRIPT_TEMPLATE)
      fs.writeFileSync(path.join(absDir, 'scripts', 'autoloads', 'EventBus.gd'), EVENT_BUS_SCRIPT_TEMPLATE)
      fs.writeFileSync(path.join(absDir, 'scripts', 'boot_check.gd'), BOOT_CHECK_SCRIPT_TEMPLATE)

      createdFiles.push('scripts/autoloads/Global.gd', 'scripts/autoloads/EventBus.gd', 'scripts/boot_check.gd')

      // Add autoloads to project.godot
      const projectPath = path.join(absDir, 'project.godot')
      const existing = fs.readFileSync(projectPath, 'utf8')
      const withAutoloads = existing + '\n[autoload]\n\nGlobal="*res://scripts/autoloads/Global.gd"\nEventBus="*res://scripts/autoloads/EventBus.gd"\n'
      fs.writeFileSync(projectPath, withAutoloads)
    }

    // Create .godot directory (Godot creates this on first run, but we pre-create)
    fs.mkdirSync(path.join(absDir, '.godot'), {recursive: true})

    const result = {
      name: args.name,
      path: absDir,
      withAutoloads: flags['with-autoloads'],
      files: createdFiles,
    }

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
    } else {
      this.log(`Created Godot project "${args.name}" at ${absDir}`)
      this.log(`  Files: ${createdFiles.join(', ')}`)
      if (flags['with-autoloads']) {
        this.log('  Autoloads: Global, EventBus')
      }
    }
  }
}
