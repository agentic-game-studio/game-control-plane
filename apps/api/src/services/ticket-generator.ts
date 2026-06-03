/**
 * ticket-generator.ts — Dependency-aware autonomous ticket generation.
 *
 * Generates tickets in strict phase order:
 *   Phase 1: FOUNDATION — player, game manager, main scene, level 1, tileset
 *   Phase 2: CORE FEATURES — enemies, hazards, collectibles, UI
 *   Phase 3: POLISH — particles, effects, audio, advanced mechanics
 *
 * Tickets are project-agnostic — they describe WHAT to build, not WHERE.
 * The agent reads project state to figure out paths and conventions.
 */

import { existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { newId } from "../utils/ids.js";
import { readData } from "./data-store.js";
import { readTicketsBoard, writeTicketsBoard, updateTicketsBoard } from "./ticket-board.js";
import type { TicketsBoard, Ticket } from "@game-studio/types";

// ─── Config ───────────────────────────────────────────────────────────────────

function getWorkspaceDir(): string {
  const env = process.env.WORKSPACE_DIR;
  if (env) return env;
  return join(__dirname, "..", "..", "..", "..", "workspace");
}

const WORKSPACE = getWorkspaceDir();

// ─── Genre Detection ──────────────────────────────────────────────────────────

type GameGenre = "platformer" | "shooter" | "puzzle" | "rpg" | "racing" | "strategy" | "generic";

const GENRE_KEYWORDS: Record<GameGenre, string[]> = {
  shooter: ["shooter", "shoot", "bullet", "gun", "weapon", "projectile", "space ship", "spaceship", "fire", "laser", "top-down", "twin-stick"],
  platformer: ["platformer", "platform", "jump", "runner", "mario", "sonic"],
  puzzle: ["puzzle", "match-3", "tetris", "blocks", "logic", "sokoban"],
  rpg: ["rpg", "role-playing", "turn-based", "dungeon", "loot", "inventory", "quest", "dialogue tree"],
  racing: ["racing", "race", "car", "driving", "track", "speed"],
  strategy: ["strategy", "tower defense", "rts", "base building", "resource", "tactics"],
  generic: [],
};

function detectGenre(description: string): GameGenre {
  const lower = description.toLowerCase();
  let bestGenre: GameGenre = "generic";
  let bestScore = 0;

  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS) as [GameGenre, string[]][]) {
    if (genre === "generic") continue;
    const score = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestGenre = genre;
    }
  }

  return bestGenre;
}

/** Build genre context to prepend to ticket descriptions */
function genreContext(genre: GameGenre, projectDescription: string): string {
  if (genre === "generic" || !projectDescription) return "";
  return `GAME CONTEXT: This is a ${genre} game. ${projectDescription.trim()}\n\nAdapt the implementation below to match this genre. For example, a shooter needs projectiles and aiming, a platformer needs gravity and jumping, a puzzle needs grid mechanics, etc.\n\n`;
}

// ─── Phase Definitions ────────────────────────────────────────────────────────

const PHASE_FOUNDATION = 1;
const PHASE_CORE = 2;
const PHASE_POLISH = 3;

interface TicketTemplate {
  id: string;
  title: string;
  description: string;
  area: string;
  subarea: string;
  credits: number;
  phase: number;
  /** File must exist for this ticket to be relevant (skip if already done) */
  skipIfFilesExist?: string[];
  /** File must NOT exist for this ticket to be relevant (skip if missing deps) */
  requireFilesExist?: string[];
  /** Assign to a specific agent role */
  agentRole?: string;
  /** If set, only generate for these genres (omit for all genres) */
  genres?: GameGenre[];
}

const TICKET_TEMPLATES: TicketTemplate[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: FOUNDATION — must complete before any other tickets
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "player_controller",
    title: "Create player character with movement, jump, and physics",
    description: `Create the core player controller — the foundation of the entire game.

REQUIREMENTS:
1. Create a player scene (scenes/player.tscn or similar):
   - CharacterBody2D root node
   - Sprite2D child (use a colored Rectangle as placeholder: ColorRect or Sprite2D with simple visual)
   - CollisionShape2D child (RectangleShape2D, ~32x48 for platformer character)
   - Camera2D child (follow player, set smoothing)

2. Create the player script:
   - extends CharacterBody2D
   - @export var speed, jump_velocity, gravity (use ProjectSettings.get_setting for gravity)
   - _physics_process: apply gravity, handle horizontal input (ui_left/ui_right), jump on ui_accept
   - move_and_slide() for movement
   - signal player_died()
   - signal health_changed(current, maximum)
   - var health / max_health with take_damage(amount) method
   - Die on health reaching 0: emit player_died, disable input briefly
   - COLLISION: collision_layer = 1 (player), collision_mask = 1+2+3 (detect world, enemies, hazards)

   IMPORTANT: Other game objects (enemies, hazards, collectibles) will reference the player
   via groups or signals. Use get_tree().get_first_node_in_group("player") or emit signals.
   The player must be in group "player" — add self to group in _ready().

3. Add the player scene to at least one level for testing

ACCEPTANCE: Player can run left/right and jump. Falls with gravity. Visible on screen.`,
    area: "engineering/gameplay",
    subarea: "player",
    credits: 200,
    phase: PHASE_FOUNDATION,
    skipIfFilesExist: ["scripts/player.gd", "scenes/player.tscn"],
  },
  {
    id: "game_manager",
    title: "Create game manager autoload for level flow and game state",
    description: `Create the game manager singleton that controls level progression and game state.

REQUIREMENTS:
1. Create a game manager script (autoloads/game_manager.gd or scripts/autoloads/game_manager.gd):
   - extends Node (autoload singleton)
   - DO NOT use class_name (causes autoload conflicts)
   - Track: current_level_index, lives, score
   - Level list: array of level scene paths — ONLY include levels that currently exist on disk. Start with [level_01.tscn] and add more as they are created. Do NOT pre-fill with levels that don't exist yet — this causes runtime crashes. Use Glob tool to verify which level_*.tscn files exist before writing the level_list array.
   - load_level(index): free current level, instantiate new one, add as child
   - next_level(): if more levels exist, advance; otherwise emit game_won signal
   - restart_level(): reload current level
   - on_player_died(): decrement lives, restart or game over
   - Signal: level_changed(level_name), game_over(), score_changed(new_score), game_won()

2. Register as autoload in project.godot:
   - Read the current project.godot content FIRST
   - Check if [autoload] section already has a GameManager entry
   - If NOT present: add [autoload] section with GameManager="*res://path/to/game_manager.gd"
   - If ALREADY present: do NOT modify project.godot autoload section — just create the script file

ACCEPTANCE: GameManager autoload loads, level list is configured, game_won signal exists for end-game.`,
    area: "engineering",
    subarea: "game-flow",
    credits: 150,
    phase: PHASE_FOUNDATION,
    skipIfFilesExist: ["autoloads/game_manager.gd", "scripts/autoloads/game_manager.gd"],
  },
  {
    id: "main_scene",
    title: "Create main scene with title screen and game flow",
    description: `Create the main scene that serves as the entry point for the game.

REQUIREMENTS:
1. Create/update the main scene (scenes/main.tscn):
   - Must be set as run/main_scene in project.godot
   - Node2D root with a simple title screen:
     - Label showing the game name (read from project.godot config/name if possible)
     - "Press Enter to Start" or a Start button
     - "Press Escape to Quit"

2. Create a main_menu script (scenes/main_menu.gd or scripts/main_menu.gd):
   - On start: call GameManager.load_level(0) to begin the game
   - On quit: get_tree().quit()

3. Wire the main scene to the game manager autoload

ACCEPTANCE: Game launches to a title screen. Pressing Enter starts level 1. The game has a clear start point.`,
    area: "engineering/ui",
    subarea: "game-flow",
    credits: 150,
    phase: PHASE_FOUNDATION,
    requireFilesExist: ["autoloads/game_manager.gd", "scripts/autoloads/game_manager.gd"],
  },
  {
    id: "level_01",
    title: "Create Level 1 — playable first level with platforms",
    description: `Create the first playable level of the game.

REQUIREMENTS:
1. Create level scene (levels/level_01.tscn or scenes/levels/level_01.tscn):
   - Node2D root
   - StaticBody2D nodes for ground and platforms (use colored rectangles as visuals)
   - Place the player instance at a start position
   - Add a finish/goal Area2D at the end that triggers level completion
   - Camera2D following the player (if not on player already)

2. Create a level script (levels/level_01.gd or scripts/level_01.gd):
   - extends Node2D
   - signal level_complete()
   - Connect goal Area2D body_entered to detect player reaching end
   - On level complete: call GameManager.next_level()

3. Make the level actually playable:
   - Ground that prevents falling through
   - Platforms to jump on
   - Clear start and end points
   - Level should take 15-30 seconds to complete
   - Level should be simple but demonstrate the core mechanic (jumping)

4. Ensure the level path is in GameManager's level list

ACCEPTANCE: Level loads, player can run and jump through it, reaching the end triggers level complete.`,
    area: "engineering/level-design",
    subarea: "levels",
    credits: 250,
    phase: PHASE_FOUNDATION,
    requireFilesExist: ["scripts/player.gd", "autoloads/game_manager.gd", "scripts/autoloads/game_manager.gd"],
    skipIfFilesExist: ["levels/level_01.tscn", "scenes/levels/level_01.tscn"],
  },
  {
    id: "hud_ui",
    title: "Create HUD with health display, score, and level indicator",
    description: `Create the in-game HUD overlay.

REQUIREMENTS:
1. Create HUD scene (scenes/hud.tscn or scenes/ui/hud.tscn):
   - CanvasLayer root (so it renders above game world)
   - Top-left: Health display (hearts or bar using ProgressBar)
   - Top-right: Score counter (Label)
   - Top-center: Level name (Label)
   - All positioned with anchors/margins for consistency

2. Create HUD script:
   - Connect to GameManager signals for score/level changes
   - Connect to player health_changed signal to update health display
   - Update displays when values change

3. Add the HUD as a child of the game manager or to each level scene

ACCEPTANCE: HUD is visible during gameplay showing health, score, and current level.`,
    area: "engineering/ui",
    subarea: "hud",
    credits: 150,
    phase: PHASE_CORE,
    requireFilesExist: ["scripts/player.gd", "autoloads/game_manager.gd", "scripts/autoloads/game_manager.gd"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: CORE FEATURES — enemies, hazards, collectibles, more levels
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "patrol_enemy",
    title: "Add ground patrol enemy",
    description: `Create a ground-based enemy that patrols back and forth.

REQUIREMENTS:
1. Create patrol enemy scene (scenes/enemies/patrol_enemy.tscn):
   - CharacterBody2D root
   - Colored rectangle sprite (red/orange to distinguish from player)
   - CollisionShape2D
   - @export var patrol_range, patrol_speed

2. Create patrol enemy script:
   - Walk in one direction, reverse at patrol_range or wall collision
   - Use raycast or edge detection to avoid walking off platforms
   - When player touches enemy: call player.take_damage()
   - Enemy dies if player stomps from above (optional: velocity.y > 0 and player above enemy)

3. Place 2-3 instances in level_01

ACCEPTANCE: Enemies walk back and forth, damage player on contact.`,
    area: "engineering/gameplay/enemies",
    subarea: "ai",
    credits: 150,
    phase: PHASE_CORE,
    requireFilesExist: ["scripts/player.gd"],
  },
  {
    id: "hazard_spikes",
    title: "Add spike hazard that kills on contact",
    description: `Create spike/ground hazard elements.

REQUIREMENTS:
1. Create spike scene (scenes/hazards/spike.tscn):
   - StaticBody2D root
   - Triangle/pointed sprite (colored red, use Polygon2D or simple shape)
   - CollisionShape2D (hazard layer)

2. Create spike script:
   - Area2D child for detecting player overlap
   - On body_entered with player: call player.take_damage(1) or emit kill signal

3. Place spikes in level_01 at strategic points (gaps, platform edges)

ACCEPTANCE: Spikes damage/kill player on contact. Clearly visible danger zones.`,
    area: "engineering/gameplay",
    subarea: "hazards",
    credits: 100,
    phase: PHASE_CORE,
    requireFilesExist: ["scripts/player.gd"],
  },
  {
    id: "collectible_coins",
    title: "Add collectible coins with score tracking",
    description: `Create coin collectibles that add to the player score.

REQUIREMENTS:
1. Create coin scene (scenes/collectibles/coin.tscn):
   - Area2D root (for collection detection)
   - Animated/colored circle sprite (gold/yellow)
   - CollisionShape2D (small circle)

2. Create coin script:
   - On body_entered with player: add to score, play pickup effect, queue_free
   - Update GameManager.score

3. Scatter 5-10 coins throughout level_01

ACCEPTANCE: Coins are visible, collected on touch, score increases.`,
    area: "engineering/gameplay",
    subarea: "collectibles",
    credits: 100,
    phase: PHASE_CORE,
    requireFilesExist: ["scripts/player.gd"],
  },
  {
    id: "level_02",
    title: "Create Level 2 — harder with enemies and hazards",
    description: `Create the second level with increased difficulty.

REQUIREMENTS:
1. Create level_02 scene (levels/level_02.tscn):
   - Longer than level_01
   - Include patrol enemies (2-3)
   - Include spike hazards
   - Include coins to collect
   - Multiple platform heights
   - Clear start and end with goal trigger

2. Create level script if needed, same pattern as level_01

3. Ensure the path is in GameManager's level list

ACCEPTANCE: Level 2 loads after completing level 1. Has enemies and hazards. Takes 30-60 seconds.`,
    area: "engineering/level-design",
    subarea: "levels",
    credits: 200,
    phase: PHASE_CORE,
    requireFilesExist: ["levels/level_01.tscn", "scenes/levels/level_01.tscn"],
    skipIfFilesExist: ["levels/level_02.tscn", "scenes/levels/level_02.tscn"],
  },
  {
    id: "death_respawn",
    title: "Add death and respawn system",
    description: `Implement player death, respawn, and game over flow.

REQUIREMENTS:
1. Update player script:
   - On take_damage: flash sprite, brief invulnerability (1.5s)
   - On death: play death animation (shrink/fade), emit player_died
   - Respawn at level start or last checkpoint

2. Update game manager:
   - On player_died: decrement lives
   - If lives > 0: restart current level
   - If lives <= 0: show game over screen

3. Create game over overlay:
   - "Game Over" text
   - "Retry" button -> restart from level 1
   - "Quit" button -> return to main menu

ACCEPTANCE: Player dies when health reaches 0. Respawns with remaining lives. Game over when lives run out.`,
    area: "engineering/gameplay",
    subarea: "game-flow",
    credits: 150,
    phase: PHASE_CORE,
    requireFilesExist: ["scripts/player.gd", "autoloads/game_manager.gd", "scripts/autoloads/game_manager.gd"],
  },
  {
    id: "pause_menu",
    title: "Add pause menu with resume/restart/quit",
    description: `Create pause menu triggered by Escape key.

REQUIREMENTS:
1. Create pause_menu scene:
   - Control node root with darkened semi-transparent background
   - "PAUSED" label
   - Resume button (or press Escape again)
   - Restart Level button
   - Quit to Menu button

2. Handle pause:
   - Escape key toggles pause
   - get_tree().paused = true/false
   - Show/hide pause overlay

ACCEPTANCE: Escape pauses game, menu shows, all buttons work.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
    phase: PHASE_CORE,
    requireFilesExist: ["autoloads/game_manager.gd", "scripts/autoloads/game_manager.gd"],
  },
  {
    id: "level_complete_screen",
    title: "Add level complete screen with stats",
    description: `Show a completion screen when player finishes a level.

REQUIREMENTS:
1. Create level_complete scene:
   - "Level Complete!" header
   - Score display
   - Time display (if timer exists)
   - "Next Level" button
   - "Replay" button

2. Connect to level_complete signal from levels
3. After showing, transition to next level on button press via GameManager

ACCEPTANCE: Level complete shows after reaching the goal, "Next Level" loads the next level.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
    phase: PHASE_CORE,
    requireFilesExist: ["levels/level_01.tscn", "scenes/levels/level_01.tscn", "autoloads/game_manager.gd", "scripts/autoloads/game_manager.gd"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: POLISH — particles, effects, advanced mechanics
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "flying_enemy",
    title: "Add flying enemy type",
    description: `Create a flying enemy that moves in a patrol pattern in the air.

1. Create flying enemy scene and script
2. Horizontal or sine-wave patrol
3. Damages player on contact
4. Place in level_02

ACCEPTANCE: Flying enemy moves in pattern, damages player.`,
    area: "engineering/gameplay/enemies",
    subarea: "ai",
    credits: 150,
    phase: PHASE_POLISH,
    requireFilesExist: ["scripts/player.gd"],
  },
  {
    id: "moving_platforms",
    title: "Add moving platforms",
    description: `Create moving platforms the player can ride.

1. Create moving platform scene (AnimatableBody2D)
2. Horizontal/vertical movement with configurable range and speed
3. Player stays on platform when riding
4. Add 2-3 to level_02

ACCEPTANCE: Platforms move, player rides them correctly.`,
    area: "engineering/gameplay",
    subarea: "physics",
    credits: 150,
    phase: PHASE_POLISH,
    requireFilesExist: ["scripts/player.gd"],
  },
  {
    id: "level_03_boss",
    title: "Create Level 3 with boss encounter",
    description: `Create the final level with a boss fight.

1. Create level_03 with all mechanics learned
2. Boss enemy: stationary with attack patterns, health bar
3. Player must dodge attacks and deal damage
4. On boss defeat: trigger game complete

ACCEPTANCE: Boss fight is winnable, game has a satisfying conclusion.`,
    area: "engineering/level-design",
    subarea: "levels",
    credits: 300,
    phase: PHASE_POLISH,
    requireFilesExist: ["levels/level_02.tscn", "scenes/levels/level_02.tscn"],
    skipIfFilesExist: ["levels/level_03.tscn", "scenes/levels/level_03.tscn"],
  },
  {
    id: "parallax_bg",
    title: "Add parallax scrolling background",
    description: `Add depth with parallax background layers.

1. Create ParallaxBackground with 2-3 layers
2. Different scroll speeds (0.1x, 0.3x, 0.5x)
3. Simple colored gradient layers (no external images needed)
4. Add to level scenes

ACCEPTANCE: Background layers scroll at different speeds creating depth.`,
    area: "engineering/visual",
    subarea: "background",
    credits: 75,
    phase: PHASE_POLISH,
  },
  {
    id: "checkpoint_system",
    title: "Add checkpoint save points in levels",
    description: `Add checkpoints so player respawns at last checkpoint instead of level start.

1. Create checkpoint scene (Area2D with flag visual)
2. On player touch: save position, change visual to "activated"
3. On death: respawn at last checkpoint
4. Add 2-3 per level

ACCEPTANCE: Checkpoints activate on touch, player respawns there after death.`,
    area: "engineering/gameplay",
    subarea: "game-flow",
    credits: 100,
    phase: PHASE_POLISH,
    requireFilesExist: ["scripts/player.gd"],
  },
  {
    id: "dust_particles",
    title: "Add particle effects for jump, land, and death",
    description: `Add particle polish for key game moments.

1. Jump: small dust puff at feet
2. Land: dust burst proportional to fall height
3. Death: explosion particles
4. Coin collect: sparkle burst

Use CPUParticles2D (no external textures needed — use simple squares).

ACCEPTANCE: Particles play on jump, land, death, and coin collect.`,
    area: "engineering/vfx",
    subarea: "particles",
    credits: 75,
    phase: PHASE_POLISH,
    requireFilesExist: ["scripts/player.gd"],
  },
  {
    id: "coyote_time_buffer",
    title: "Add coyote time and jump buffering for better feel",
    description: `Improve jump feel with coyote time and input buffering.

1. Coyote time: allow jump for ~100ms after leaving platform edge
2. Jump buffer: if player presses jump ~100ms before landing, execute on land
3. Both are common platformer feel improvements

ACCEPTANCE: Jumping feels responsive near edges and when pressing slightly early.`,
    area: "engineering/gameplay",
    subarea: "feel",
    credits: 50,
    phase: PHASE_POLISH,
    requireFilesExist: ["scripts/player.gd"],
  },
  {
    id: "game_complete_screen",
    title: "Add game complete / credits screen",
    description: `Show victory screen when all levels are complete.

1. "Congratulations!" message
2. Final score and time
3. "Play Again" and "Main Menu" buttons
4. Connect to GameManager.game_won signal to show this screen

ACCEPTANCE: Game complete screen shows after final level, buttons work.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
    phase: PHASE_POLISH,
    requireFilesExist: ["levels/level_01.tscn", "scenes/levels/level_01.tscn", "autoloads/game_manager.gd", "scripts/autoloads/game_manager.gd"],
  },

  // Creative production tickets (Phase 2–3)
  {
    id: "player_sprite_art",
    title: "Generate and wire player character sprite",
    description: `Use GenerateAsset to create a player character sprite (512x512, category: character).
Then update the player scene to use the generated texture instead of ColorRect placeholder.

REQUIREMENTS:
1. Call GenerateAsset with art-bible-aligned prompt (pixel art, orthographic)
2. Reference res://assets/character/ in player scene Sprite2D
3. Preserve collision and movement scripts

ACCEPTANCE: Player displays generated sprite in-game.`,
    area: "art/sprites",
    subarea: "character",
    credits: 150,
    phase: PHASE_CORE,
    agentRole: "art-director",
    requireFilesExist: ["scripts/player.gd"],
  },
  {
    id: "tileset_art",
    title: "Generate tileset textures for levels",
    description: `Generate platform/tile textures via GenerateAsset (category: tex).
Wire into TileMap or tileset resource used by level scenes.

ACCEPTANCE: Levels use generated tile textures, not flat colors.`,
    area: "art/tilesets",
    subarea: "tilesets",
    credits: 120,
    phase: PHASE_CORE,
    agentRole: "art-director",
    requireFilesExist: ["levels/level_01.tscn", "scenes/levels/level_01.tscn"],
  },
  {
    id: "sfx_jump_coin",
    title: "Generate jump and coin SFX",
    description: `Use GenerateAudio tool for jump and coin collect sounds.
Place .wav files in assets/audio/ and wire to player and coin scripts.

ACCEPTANCE: Jump and coin sounds play in-game.`,
    area: "art/sfx",
    subarea: "sfx",
    credits: 80,
    phase: PHASE_CORE,
    agentRole: "sound-designer",
    requireFilesExist: ["scripts/player.gd"],
  },
  {
    id: "hud_art",
    title: "Generate HUD icons (health, coin)",
    description: `Generate UI icons via GenerateAsset (category: ui) for health and coin counter.
Wire into HUD scene TextureRects.

ACCEPTANCE: HUD shows generated icons.`,
    area: "art/sprites",
    subarea: "ui",
    credits: 100,
    phase: PHASE_CORE,
    agentRole: "art-director",
    requireFilesExist: ["autoloads/game_manager.gd", "scripts/autoloads/game_manager.gd"],
  },
  {
    id: "opening_dialogue",
    title: "Write opening dialogue and wire dialogue UI",
    description: `Write opening dialogue CSV/JSON per write-dialogue skill.
Add simple dialogue box UI triggered at level start.

ACCEPTANCE: Opening dialogue displays on level 1 start.`,
    area: "content/dialogue",
    subarea: "dialogue",
    credits: 100,
    phase: PHASE_POLISH,
    agentRole: "writer",
  },
  {
    id: "localization_strings",
    title: "Extract strings and setup TranslationServer",
    description: `Extract UI strings to CSV, create .translation resources, enable locale in project settings.

ACCEPTANCE: At least en + th locale files exist; HUD strings use tr().`,
    area: "content/localization",
    subarea: "localization",
    credits: 120,
    phase: PHASE_POLISH,
    agentRole: "localization-lead",
  },

  // Genre-specific: shooter
  {
    id: "shooter_projectiles",
    title: "Implement shooting and projectiles",
    description: `SHOOTER MODE: Add projectile shooting with aim direction, fire rate, and bullet pooling.
Use CharacterBody2D or Area2D bullets. Skip if not a shooter game.

ACCEPTANCE: Player can shoot projectiles toward cursor/aim direction.`,
    area: "engineering/combat",
    subarea: "combat",
    credits: 200,
    phase: PHASE_CORE,
    agentRole: "godot-specialist",
    requireFilesExist: ["scripts/player.gd"],
    genres: ["shooter"],
  },
  {
    id: "puzzle_grid",
    title: "Implement puzzle grid mechanics",
    description: `PUZZLE MODE: Add grid-based puzzle board with tile swapping/matching logic.
Skip if not a puzzle game.

ACCEPTANCE: Puzzle grid responds to player input with valid move rules.`,
    area: "engineering/gameplay",
    subarea: "puzzle",
    credits: 200,
    phase: PHASE_CORE,
    agentRole: "godot-specialist",
    requireFilesExist: ["scripts/player.gd"],
    genres: ["puzzle"],
  },

  // Genre-specific: RPG
  {
    id: "rpg_inventory",
    title: "Implement inventory and item system",
    description: `RPG MODE: Add inventory autoload with item resources, pickup, equip/use, and UI panel.
Include at least 3 sample items (potion, sword, key).

ACCEPTANCE: Player can pick up items, open inventory UI, and use/equip items.`,
    area: "engineering/gameplay",
    subarea: "inventory",
    credits: 220,
    phase: PHASE_CORE,
    agentRole: "godot-specialist",
    requireFilesExist: ["scripts/player.gd"],
    genres: ["rpg"],
  },
  {
    id: "rpg_dialogue_quest",
    title: "Implement dialogue tree and quest log",
    description: `RPG MODE: Add dialogue system with branching choices and quest log autoload.
Wire NPC interaction (Area2D + E key) and at least one fetch quest.

ACCEPTANCE: NPC dialogue shows choices; quest log updates on quest accept/complete.`,
    area: "content/narrative",
    subarea: "quests",
    credits: 200,
    phase: PHASE_CORE,
    agentRole: "writer",
    requireFilesExist: ["scripts/player.gd"],
    genres: ["rpg"],
  },

  // Genre-specific: racing
  {
    id: "racing_vehicle",
    title: "Implement vehicle controller and track",
    description: `RACING MODE: Replace platformer movement with vehicle physics (acceleration, steering, drift).
Add a simple oval or loop track with checkpoints and lap counter.

ACCEPTANCE: Vehicle drives on track; lap time and checkpoint order tracked.`,
    area: "engineering/gameplay",
    subarea: "racing",
    credits: 220,
    phase: PHASE_CORE,
    agentRole: "godot-specialist",
    requireFilesExist: ["scripts/player.gd"],
    genres: ["racing"],
  },

  // Genre-specific: strategy
  {
    id: "strategy_grid_units",
    title: "Implement strategy grid and unit selection",
    description: `STRATEGY MODE: Add tile grid map, unit placement, click-to-select, move orders, and simple AI opponent turn.

ACCEPTANCE: Player selects units on grid, issues move; enemy takes a basic turn.`,
    area: "engineering/gameplay",
    subarea: "strategy",
    credits: 240,
    phase: PHASE_CORE,
    agentRole: "godot-specialist",
    requireFilesExist: ["scripts/player.gd"],
    genres: ["strategy"],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  // 11-H13: 128-bit id. Previously this was `Date.now() + 4 base36 chars`,
  // which collided when a GDD's ingestion produced many tickets in the
  // same millisecond (e.g. 50 quests from a single breakdown).
  return newId(prefix);
}

/**
 * Scan project directory for existing files matching a set of patterns.
 * Returns relative paths of found files.
 *
 * 15-CR-async-walk: converted from readdirSync to readdir (async). The
 * sync version was called once per TICKET_TEMPLATE per generateTickets
 * invocation, and the autonomous loop invokes generateTickets on every
 * empty-queue iteration — on a 1000-file project that was 60+ blocking
 * readdir calls per iteration, freezing WS broadcasts for hundreds of ms
 * on slow filesystems. Recursive walks are also bounded by a depth cap
 * so a symlink loop can't make this hang.
 */
async function findProjectFiles(projectPath: string, patterns: string[]): Promise<string[]> {
  const found: string[] = [];
  const search = async (dir: string, root: string, depth: number): Promise<void> => {
    if (depth > 16) return; // 16 levels is plenty for any sane Godot project
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name.toLowerCase() === "addons") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await search(full, root, depth + 1);
      } else if (entry.isFile() && patterns.some((p) =>
        entry.name === p ||                    // exact filename match (e.g. "player.gd")
        entry.name.endsWith(p) ||              // extension match (e.g. ".gd", ".tscn")
        full.endsWith(`/${p}`)                 // path suffix match
      )) {
        found.push(full.replace(root + "/", ""));
      }
    }
  };
  if (existsSync(projectPath)) await search(projectPath, projectPath, 0);
  return found;
}

async function anyFileExists(projectPath: string, files: string[]): Promise<boolean> {
  // Fast path: exact match
  if (files.some((f) => existsSync(join(projectPath, f)))) return true;
  // Fuzzy fallback: match by basename stem (exact or with separator suffix)
  // e.g. "player.gd" matches "player.gd", "player_controller.gd", "player-character.gd"
  // but NOT "player_died.gd", "player_anim.gd" (those aren't the main player script)
  const requiredStems = files.map((f) => (f.split("/").pop() ?? f).replace(/\.\w+$/, "").toLowerCase());
  const allFiles = await findProjectFiles(projectPath, [".gd", ".tscn"]);
  return allFiles.some((found) => {
    const foundStem = (found.split("/").pop() ?? "").replace(/\.\w+$/, "").toLowerCase();
    return requiredStems.some((stem) =>
      foundStem === stem ||
      foundStem === `${stem}_controller` ||
      foundStem === `${stem}_character` ||
      foundStem === `${stem}-controller` ||
      foundStem === `${stem}-character`
    );
  });
}

/**
 * Check that ALL required files exist, with alternative path support.
 * Groups entries by basename stem — entries sharing the same stem are alternatives.
 * Each unique stem group must have at least one match on disk.
 */
async function allRequiredFilesExist(projectPath: string, files: string[]): Promise<boolean> {
  // Group by basename stem. Within a stem group, any file is sufficient (OR logic).
  // Across stem groups, ALL groups must be satisfied (AND logic).
  // Example: ["autoloads/game_manager.gd", "scripts/game_manager.gd"] → stem "game_manager", either path works.
  // Example: ["player.gd", "game_manager.gd"] → stems "player" AND "game_manager", both must exist.
  // NOTE: Files with same stem but different extensions (e.g., "player.gd" + "player.tscn") are
  // treated as the same stem — only one needs to exist. Don't use this for requiring both .gd and .tscn.
  const stemGroups = new Map<string, string[]>();
  for (const f of files) {
    const base = f.split("/").pop() ?? f;
    const stem = base.replace(/\.\w+$/, "").toLowerCase();
    if (!stemGroups.has(stem)) stemGroups.set(stem, []);
    stemGroups.get(stem)!.push(f);
  }

  const allFiles = await findProjectFiles(projectPath, [".gd", ".tscn"]);

  for (const [stem, alternatives] of stemGroups) {
    // Check if any alternative path exists (exact match)
    const exactMatch = alternatives.some((f) => existsSync(join(projectPath, f)));
    if (exactMatch) continue;

    // Fuzzy fallback: check if any file on disk matches this stem
    const fuzzyMatch = allFiles.some((found) => {
      const foundStem = (found.split("/").pop() ?? "").replace(/\.\w+$/, "").toLowerCase();
      return foundStem === stem ||
        foundStem === `${stem}_controller` ||
        foundStem === `${stem}_character` ||
        foundStem === `${stem}-controller` ||
        foundStem === `${stem}-character`;
    });
    if (!fuzzyMatch) return false; // This stem group is unsatisfied
  }
  return true; // All stem groups have at least one match
}

function ticketExistsByTitle(board: TicketsBoard, title: string): boolean {
  const titleLower = title.toLowerCase();
  for (const col of board.columns) {
    for (const t of col.tickets) {
      if (t.title.toLowerCase() === titleLower) return true;
    }
  }
  return false;
}

function ticketExistsById(board: TicketsBoard, id: string): boolean {
  for (const col of board.columns) {
    for (const t of col.tickets) {
      if ((t as unknown as Record<string, unknown>).templateId === id) return true;
    }
  }
  return false;
}

// ─── Core Generator ───────────────────────────────────────────────────────────

/**
 * generateTickets — Scans project, generates missing tickets in dependency order.
 * Foundation tickets (phase 1) are always generated first.
 * Core features (phase 2) only after foundation files exist.
 * Polish (phase 3) only after core features exist.
 */
export async function generateTickets(projectId: string, workspacePath?: string, projectDescription?: string): Promise<Ticket[]> {
  const effectivePath = workspacePath ?? projectId;
  const projectPath = join(WORKSPACE, effectivePath);
  if (!workspacePath || !existsSync(projectPath)) {
    return [];
  }

  // Detect game genre from project description to adapt ticket context
  const genre = detectGenre(projectDescription ?? "");

  const board = await readTicketsBoard(projectId);
  const newTickets: Ticket[] = [];

  for (const template of TICKET_TEMPLATES) {
    if (template.genres && template.genres.length > 0) {
      if (genre !== "generic" && !template.genres.includes(genre)) continue;
      if (genre === "generic") continue;
    }

    // Skip if this ticket (by template ID or title) already exists on the board
    if (ticketExistsById(board, template.id) || ticketExistsByTitle(board, template.title)) {
      continue;
    }
    // Also skip if already queued in this batch (prevents duplicates within one generateTickets call)
    if (newTickets.some((t) => t.title === template.title)) {
      continue;
    }

    // Skip if the files this ticket would create already exist
    if (template.skipIfFilesExist && (await anyFileExists(projectPath, template.skipIfFilesExist))) {
      continue;
    }

    // Skip if required dependency files don't exist yet (all stem groups must be satisfied)
    if (template.requireFilesExist && !(await allRequiredFilesExist(projectPath, template.requireFilesExist))) {
      continue;
    }

    const ticket: Ticket & { templateId?: string; phase?: number } = {
      id: generateId("ticket"),
      projectId,
      title: template.title,
      description: genreContext(genre, projectDescription ?? "") + template.description,
      area: template.area,
      subarea: template.subarea,
      credits: template.credits,
      status: "available",
      acknowledged: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentRole: template.agentRole ?? "godot-specialist",
      templateId: template.id,
      phase: template.phase,
    };

    newTickets.push(ticket);
  }

  // Sort by phase first, then by credits within each phase
  newTickets.sort((a, b) => {
    const phaseA = (a as unknown as Record<string, unknown>).phase as number ?? 2;
    const phaseB = (b as unknown as Record<string, unknown>).phase as number ?? 2;
    if (phaseA !== phaseB) return phaseA - phaseB;
    return b.credits - a.credits;
  });

  return newTickets;
}

/**
 * addTicketsToBoard — Adds generated tickets to the available column.
 */
export async function addTicketsToBoard(projectId: string, tickets: Ticket[]): Promise<void> {
  if (tickets.length === 0) return;

  await updateTicketsBoard(projectId, (board) => {
    const availableCol = board.columns.find((c) => c.id === "available");
    if (!availableCol) throw new Error("No 'available' column found in project ticket board");

    for (const ticket of tickets) {
      availableCol.tickets.push(ticket);
    }
    return board;
  });
}

/**
 * scanProjectState — Build a manifest of existing project files for agent context.
 * Called by the autonomous loop to inject into agent prompts.
 */
export async function scanProjectState(projectPath: string): Promise<string> {
  const lines: string[] = [];
  lines.push("=== PROJECT STATE ===");

  if (!existsSync(projectPath)) {
    lines.push("WARNING: Project directory does not exist!");
    lines.push("=== END PROJECT STATE ===");
    return lines.join("\n");
  }

  // Check project.godot
  const projectGodot = join(projectPath, "project.godot");
  if (existsSync(projectGodot)) {
    const content = await readFile(projectGodot, "utf8");
    const nameMatch = content.match(/config\/name="([^"]+)"/);
    const versionMatch = content.match(/config\/features=PackedStringArray\("([^"]+)"/);
    const mainSceneMatch = content.match(/run\/main_scene="([^"]+)"/);

    lines.push(`Game: ${nameMatch?.[1] ?? "Unknown"}`);
    lines.push(`Godot: ${versionMatch?.[1] ?? "4.x"}`);
    lines.push(`Main scene: ${mainSceneMatch?.[1] ?? "not set"}`);

    // List autoloads
    const autoloadMatch = content.match(/\[autoload\]([^[]*)/s);
    if (autoloadMatch) {
      const autoloads = autoloadMatch[1].split("\n").filter((l) => l.includes("=")).map((l) => l.split("=")[0].trim());
      if (autoloads.length > 0) lines.push(`Autoloads: ${autoloads.join(", ")}`);
    }
  } else {
    lines.push("WARNING: No project.godot found!");
  }

  // List all scenes and scripts
  const scenes = await findProjectFiles(projectPath, [".tscn"]);
  const scripts = await findProjectFiles(projectPath, [".gd"]);
  const assets = await findProjectFiles(projectPath, [".png", ".svg", ".wav", ".ogg"]);

  if (scenes.length > 0) {
    lines.push(`\nScenes (${scenes.length}):`);
    for (const s of scenes.slice(0, 20)) lines.push(`  ${s}`);
    if (scenes.length > 20) lines.push(`  ... and ${scenes.length - 20} more`);
  } else {
    lines.push("\nNo scenes found.");
  }

  if (scripts.length > 0) {
    lines.push(`\nScripts (${scripts.length}):`);
    for (const s of scripts.slice(0, 20)) lines.push(`  ${s}`);
    if (scripts.length > 20) lines.push(`  ... and ${scripts.length - 20} more`);
  } else {
    lines.push("\nNo scripts found.");
  }

  if (assets.length > 0) {
    lines.push(`\nAssets (${assets.length}): ${assets.slice(0, 5).join(", ")}${assets.length > 5 ? ` ... and ${assets.length - 5} more` : ""}`);
  }

  lines.push("\n=== END PROJECT STATE ===");
  return lines.join("\n");
}
