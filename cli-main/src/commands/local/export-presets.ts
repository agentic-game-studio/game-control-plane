import {Flags} from '@oclif/core'
import {Command} from '@oclif/core'
import fs from 'node:fs'
import path from 'node:path'
import {findPreset, getBasePreset, getMajorVersion, type GodotMajorVersion, type Platform as GEPPlatform, loadExportPresets, saveExportPresets} from 'godot-export-presets'
import {getGodotVersion, getProjectName} from '@cli/utils/local/godot-exec.js'

const GEP_PLATFORMS = new Set(['android', 'ios'])

const PLATFORM_GODOT_NAMES: Record<string, string> = {
  web: 'Web',
  windows: 'Windows Desktop',
  linux: 'Linux/X11',
  macos: 'macOS',
  android: 'Android',
  ios: 'iOS',
}

const PLATFORM_OUTPUT_PATHS: Record<string, string> = {
  web: 'builds/web/index.html',
  windows: 'builds/windows/{name}.exe',
  linux: 'builds/linux/{name}.x86_64',
  macos: 'builds/macos/{name}.app',
  android: 'builds/android/{name}.apk',
  ios: 'builds/ios/{name}.ipa',
}

function sanitizeForPath(name: string): string {
  return name.replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9_ .()-]/g, '').trim() || 'Game'
}

function makePreset(idx: number, platform: string, projectName: string, runnable: boolean): string {
  const name = PLATFORM_GODOT_NAMES[platform]
  const safeName = sanitizeForPath(projectName)
  const outputPath = PLATFORM_OUTPUT_PATHS[platform].replace('{name}', safeName)
  const header = `[preset.${idx}]\nname="${name}"\nplatform="${name}"\nrunnable=${runnable}\ndedicated_server=false\ncustom_features=""\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\nexport_path="${outputPath}"\nencryption_include_filters=""\nencryption_exclude_filters=""\nencrypt_pck=false\nencrypt_directory=false`

  const scriptMode = '\nscript/export_mode=1'
  const optsHeader = `\n\n[preset.${idx}.options]\n`

  switch (platform) {
    case 'web':
      return `${header}${scriptMode}${optsHeader}custom_template/debug=""\ncustom_template/release=""\nvariant/extensions_capability=false\nvram_texture_compression/for_desktop=true\nvram_texture_compression/for_mobile=false\nhtml/export_icon=true\nhtml/custom_html_shell=""\nhtml/head_include=""\nhtml/canvas_resize_policy=2\nhtml/focus_canvas_on_start=true\nhtml/experimental_virtual_keyboard=false\nprogressive_web_app/enabled=false\nprogressive_web_app/offline_page=""\nprogressive_web_app/display=1\nprogressive_web_app/orientation=0\nprogressive_web_app/icon_144x144=""\nprogressive_web_app/icon_180x180=""\nprogressive_web_app/icon_512x512=""\nprogressive_web_app/background_color=Color(0, 0, 0, 1)\n`

    case 'windows':
      return `${header}${scriptMode}${optsHeader}custom_template/debug=""\ncustom_template/release=""\ndebug/export_console_wrapper=1\nbinary_format/embed_pck=false\ntexture_format/s3tc_bptc=true\ntexture_format/etc2_astc=false\nbinary_format/architecture="x86_64"\ncodesign/enable=false\ncodesign/timestamp=true\ncodesign/timestamp_server_url=""\ncodesign/digest_algorithm=1\ncodesign/description=""\ncodesign/custom_options=PackedStringArray()\napplication/modify_resources=true\napplication/icon=""\napplication/icon_interpolation=4\napplication/console_wrapper_icon=""\napplication/file_version=""\napplication/product_version=""\napplication/company_name=""\napplication/product_name=""\napplication/file_description=""\napplication/copyright=""\napplication/trademarks=""\nssh_remote_deploy/enabled=false\nssh_remote_deploy/host="user@host_ip"\nssh_remote_deploy/port="22"\nssh_remote_deploy/extra_args_ssh=""\nssh_remote_deploy/extra_args_scp=""\nssh_remote_deploy/run_script=""\nssh_remote_deploy/cleanup_script=""\n`

    case 'linux':
      return `${header}${scriptMode}${optsHeader}custom_template/debug=""\ncustom_template/release=""\ndebug/export_console_wrapper=1\nbinary_format/embed_pck=false\ntexture_format/s3tc_bptc=true\ntexture_format/etc2_astc=false\nbinary_format/architecture="x86_64"\nssh_remote_deploy/enabled=false\nssh_remote_deploy/host="user@host_ip"\nssh_remote_deploy/port="22"\nssh_remote_deploy/extra_args_ssh=""\nssh_remote_deploy/extra_args_scp=""\nssh_remote_deploy/run_script=""\nssh_remote_deploy/cleanup_script=""\n`

    case 'macos':
      return `${header}${scriptMode}${optsHeader}custom_template/debug=""\ncustom_template/release=""\ndebug/export_console_wrapper=1\nbinary_format/architecture="universal"\napplication/icon=""\napplication/icon_interpolation=4\napplication/bundle_identifier="com.example.${projectName.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'game'}"\napplication/signature=""\napplication/app_category="Games"\napplication/short_version="1.0"\napplication/version="1.0"\napplication/copyright=""\napplication/copyright_localized={}\ndisplay/high_res=true\ncodesign/codesign=0\ncodesign/installer_identity=""\ncodesign/apple_team_id=""\ncodesign/identity=""\ncodesign/entitlements/custom_file=""\ncodesign/entitlements/allow_jit_code_execution=false\ncodesign/entitlements/allow_unsigned_executable_memory=false\ncodesign/entitlements/allow_dyld_environment_variables=false\ncodesign/entitlements/disable_library_validation=false\ncodesign/entitlements/audio_input=false\ncodesign/entitlements/camera=false\ncodesign/entitlements/location=false\ncodesign/entitlements/network_server=false\ncodesign/entitlements/network_client=false\ncodesign/entitlements/hardened_runtime=true\ncodesign/custom_options=PackedStringArray()\nnotarization/notarization=0\nprivacy/microphone_usage_description=""\nprivacy/camera_usage_description=""\nssh_remote_deploy/enabled=false\nssh_remote_deploy/host="user@host_ip"\nssh_remote_deploy/port="22"\nssh_remote_deploy/extra_args_ssh=""\nssh_remote_deploy/extra_args_scp=""\nssh_remote_deploy/run_script=""\nssh_remote_deploy/cleanup_script=""\n`

    default:
      return `${header}${scriptMode}${optsHeader}custom_template/debug=""\ncustom_template/release=""\n`
  }
}

function fixLibraryCorruption(content: string): string {
  // The godot-export-presets library's serializer corrupts certain values:
  // PackedStringArray() -> empty string, {} -> [object Object]
  return content
    .replace(/codesign\/custom_options=\n/g, 'codesign/custom_options=PackedStringArray()\n')
    .replace(/codesign\/custom_options=\r\n/g, 'codesign/custom_options=PackedStringArray()\r\n')
    .replace(/application\/copyright_localized=\[object Object\]/g, 'application/copyright_localized={}')
    .replace(/script_export_mode=/g, 'script/export_mode=')
}

export default class LocalExportPresets extends Command {
  static override description = 'Generate export_presets.cfg for all target platforms'

  static override examples = [
    '<%= config.bin %> local export-presets --platforms web,windows',
    '<%= config.bin %> local export-presets --platforms web,windows,linux,macos --json',
    '<%= config.bin %> local export-presets --platforms all --json',
  ]

  static override flags = {
    json: Flags.boolean({description: 'Output as JSON'}),
    platforms: Flags.string({
      description: 'Comma-separated platforms: web,windows,linux,macos,android,ios,all',
      default: 'web,windows,linux,macos',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LocalExportPresets)

    const projectGodot = path.join(process.cwd(), 'project.godot')
    if (!fs.existsSync(projectGodot)) {
      this.error('No Godot project detected (missing project.godot)', {exit: 1})
    }

    const godotVersion = getGodotVersion()
    let majorVersion: GodotMajorVersion
    try {
      majorVersion = getMajorVersion(godotVersion)
    } catch {
      majorVersion = 4
    }
    const projectName = getProjectName()
    const platformInput = flags.platforms.toLowerCase().trim()
    const allPlatforms = ['web', 'windows', 'linux', 'macos', 'android', 'ios']
    const rawPlatforms = platformInput === 'all' ? allPlatforms : platformInput.split(',').map((p) => p.trim())
    const platforms = [...new Set(rawPlatforms)]

    const exportPresetsPath = path.join(process.cwd(), 'export_presets.cfg')

    // Read existing content and find max preset index
    let existingContent = ''
    if (fs.existsSync(exportPresetsPath)) {
      existingContent = fs.readFileSync(exportPresetsPath, 'utf8')
    }

    const generated: string[] = []
    const skipped: string[] = []
    let mobilePresetsWritten = false

    // Handle mobile platforms via godot-export-presets library
    // Strategy: save to a TEMP file to avoid library round-trip corrupting desktop presets
    const libPlatforms = platforms.filter((p) => GEP_PLATFORMS.has(p))
    if (libPlatforms.length > 0) {
      const mobileOnlyPath = exportPresetsPath + '.mobile.tmp'
      let mobileContent = ''
      try {
        const sections = existingContent.split(/\n(?=\[preset\.\d+\])/)
        const mobileSections = sections.filter((s) =>
          s.includes('platform="Android"') || s.includes('platform="iOS"'),
        )
        if (mobileSections.length > 0) {
          mobileContent = mobileSections.join('\n')
        }
      } catch { /* no existing mobile presets */ }

      fs.writeFileSync(mobileOnlyPath, mobileContent)

      try {
        let mobilePresets: {presets: unknown[]} = {presets: []}
        try {
          mobilePresets = await loadExportPresets(mobileOnlyPath)
        } catch { /* empty or invalid */ }

        for (const platform of libPlatforms) {
          const gepPlatform = platform === 'ios' ? 'iOS' : 'Android'
          const existing = findPreset(mobilePresets, {platform: gepPlatform as GEPPlatform})
          if (existing) {
            skipped.push(`${platform} (already exists)`)
            continue
          }
          const preset = getBasePreset(gepPlatform as GEPPlatform, majorVersion)
          mobilePresets.presets.push(preset)
          generated.push(platform)
        }

        if (generated.some((g) => libPlatforms.includes(g))) {
          await saveExportPresets(mobileOnlyPath, mobilePresets)
          let mobileOutput = fs.readFileSync(mobileOnlyPath, 'utf8')
          mobileOutput = fixLibraryCorruption(mobileOutput)

          // Fix export_path for mobile presets to use our convention
          const safeName = sanitizeForPath(projectName)
          mobileOutput = mobileOutput.replace(
            /export_path="[^"]*"/g,
            (match: string) => {
              if (match.includes('.aab') || match.includes('.apk')) {
                return `export_path="builds/android/${safeName}.aab"`
              }
              if (match.includes('.ipa') || match.includes('output')) {
                return `export_path="builds/ios/${safeName}.ipa"`
              }
              return match
            },
          )

          // Find max index from non-mobile presets and reindex mobile presets
          const existingSections = existingContent.split(/\n(?=\[preset\.\d+\])/)
          const nonMobileSections = existingSections.filter((s) =>
            !s.includes('platform="Android"') && !s.includes('platform="iOS"'),
          )
          let maxExistingIdx = -1
          for (const sec of nonMobileSections) {
            const m = sec.match(/\[preset\.(\d+)\]/)
            if (m) maxExistingIdx = Math.max(maxExistingIdx, Number.parseInt(m[1], 10))
          }

          // Reindex mobile presets starting after existing desktop presets
          let mobileIdx = 0
          mobileOutput = mobileOutput.replace(/\[preset\.(\d+)\]/g, () => {
            const newIdx = maxExistingIdx + 1 + mobileIdx
            mobileIdx++
            return `[preset.${newIdx}]`
          })
          // Also reindex the options sections
          mobileIdx = 0
          mobileOutput = mobileOutput.replace(/\[preset\.(\d+)\.options\]/g, () => {
            const newIdx = maxExistingIdx + 1 + mobileIdx
            mobileIdx++
            return `[preset.${newIdx}.options]`
          })

          existingContent = nonMobileSections.join('\n').trimEnd() + '\n' + mobileOutput.trimEnd() + '\n'
          mobilePresetsWritten = true
        }
      } finally {
        if (fs.existsSync(mobileOnlyPath)) fs.unlinkSync(mobileOnlyPath)
      }
    }

    // Recalculate next index after mobile presets may have been added
    let nextIndex = 0
    const presetMatches = [...existingContent.matchAll(/\[preset\.(\d+)\]/g)]
    if (presetMatches.length > 0) {
      nextIndex = Math.max(...presetMatches.map((m) => Number.parseInt(m[1], 10))) + 1
    }

    // Handle desktop/web platforms via templates with proper indexing
    // Determine which preset should be runnable (first preset gets it)
    const hasExistingPresets = presetMatches.length > 0
    const desktopPlatforms = platforms.filter((p) => !GEP_PLATFORMS.has(p) && PLATFORM_GODOT_NAMES[p])
    if (desktopPlatforms.length > 0) {
      let newContent = existingContent

      for (const platform of desktopPlatforms) {
        const presetName = PLATFORM_GODOT_NAMES[platform]
        if (newContent.includes(`platform="${presetName}"`)) {
          skipped.push(`${platform} (already exists)`)
          continue
        }
        const runnable = !hasExistingPresets && nextIndex === 0
        newContent += '\n' + makePreset(nextIndex, platform, projectName, runnable)
        nextIndex++
        generated.push(platform)
      }

      // Write if desktop presets changed OR mobile presets were merged into existingContent
      if (newContent !== existingContent || mobilePresetsWritten) {
        fs.writeFileSync(exportPresetsPath, newContent)
      }
    } else if (mobilePresetsWritten) {
      // Only mobile presets — write the updated content
      fs.writeFileSync(exportPresetsPath, existingContent)
    }

    // Report unknown platforms
    for (const platform of platforms) {
      if (!PLATFORM_GODOT_NAMES[platform]) {
        skipped.push(`${platform} (unknown)`)
      }
    }

    const result = {
      generated,
      skipped,
      platforms: flags.platforms,
      godotVersion,
      projectName,
      path: exportPresetsPath,
    }

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
    } else {
      if (generated.length > 0) {
        this.log(`Generated export presets for: ${generated.join(', ')}`)
      }
      if (skipped.length > 0) {
        this.log(`Skipped: ${skipped.join(', ')}`)
      }
      this.log(`Saved to: ${exportPresetsPath}`)
    }
  }
}
