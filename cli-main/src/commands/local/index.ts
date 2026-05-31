import {Command} from '@oclif/core'

export default class Local extends Command {
  static override description = 'Local Godot operations (no cloud required)'

  static override examples = [
    '<%= config.bin %> local init MyGame',
    '<%= config.bin %> local detect --json',
    '<%= config.bin %> local export-presets --platforms web,windows --json',
    '<%= config.bin %> local templates --json',
    '<%= config.bin %> local build --platform web --json',
    '<%= config.bin %> local package --platform macos --json',
    '<%= config.bin %> local check --json',
    '<%= config.bin %> local validate --json',
  ]

  async run(): Promise<void> {
    this.log('Local Godot commands (no cloud required):\n')
    this.log('  local init <name>          Scaffold a new Godot project')
    this.log('  local detect               Detect and report Godot project info')
    this.log('  local export-presets        Generate export_presets.cfg')
    this.log('  local templates             Check/install export templates')
    this.log('  local build                 Run headless export locally')
    this.log('  local package               Package builds (.dmg, .zip, .tar.gz)')
    this.log('  local check                 Validate GDScripts')
    this.log('  local test                  Run GUT tests')
    this.log('  local validate              Full project validation')
    this.log('')
    this.log('Add --json for machine-readable output.')
  }
}
