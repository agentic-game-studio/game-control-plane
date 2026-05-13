/**
 * ticket-generator.ts — GDD-driven autonomous ticket generation.
 *
 * Scans the game project (scenes, scripts) and generates tickets
 * for missing features. Cross-references existing tickets to avoid duplicates.
 *
 * Runs when the available ticket queue is empty (or below threshold).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readData } from "./data-store.js";
import { readTicketsBoard, writeTicketsBoard } from "./ticket-board.js";
import type { TicketsBoard, Ticket } from "@game-studio/types";

// ─── Config ───────────────────────────────────────────────────────────────────

// Detect workspace from environment or default
function getWorkspaceDir(): string {
  // Try WORKSPACE_DIR env var first
  const env = process.env.WORKSPACE_DIR;
  if (env) return env;
  // Fallback: derive from this file's location
  return join(__dirname, "..", "..", "..", "..", "workspace");
}

const WORKSPACE = getWorkspaceDir();

// ─── Feature Registry ─────────────────────────────────────────────────────────

interface FeatureCheck {
  keywords: string[];
  filesMustExist: string[];
  area: string;
  subarea: string;
  credits: number;
}

const FEATURE_CHECKS: FeatureCheck[] = [
  { keywords: ["spike", "hazard", "pit", "danger_zone"], filesMustExist: [], area: "engineering/gameplay", subarea: "hazards", credits: 150 },
  { keywords: ["health_bar", "health_display", "player_hp"], filesMustExist: [], area: "engineering/ui", subarea: "ui", credits: 100 },
  { keywords: ["spring", "bounce_pad", "bounce"], filesMustExist: [], area: "engineering/gameplay", subarea: "physics", credits: 100 },
  { keywords: ["level_02", "scene/levels/level_02"], filesMustExist: [], area: "engineering/level-design", subarea: "levels", credits: 200 },
  { keywords: ["moving_platform"], filesMustExist: [join(WORKSPACE, "pixel-platformer-1/scenes/platforms/moving_platform.tscn")], area: "engineering/gameplay", subarea: "physics", credits: 150 },
  { keywords: ["coin", "score", "score_display"], filesMustExist: [], area: "engineering/ui", subarea: "ui", credits: 100 },
  { keywords: ["pause_menu", "pause_screen"], filesMustExist: [], area: "engineering/ui", subarea: "ui", credits: 100 },
  { keywords: ["game_complete", "credits_screen"], filesMustExist: [], area: "engineering/ui", subarea: "ui", credits: 150 },
  { keywords: ["flying_enemy", "flying"], filesMustExist: [], area: "engineering/gameplay/enemies", subarea: "ai", credits: 200 },
  { keywords: ["ladder", "climbing"], filesMustExist: [], area: "engineering/gameplay", subarea: "movement", credits: 150 },
  { keywords: ["dash", "dash_move"], filesMustExist: [], area: "engineering/gameplay", subarea: "movement", credits: 150 },
  { keywords: ["save_system", "save_game"], filesMustExist: [], area: "engineering", subarea: "persistence", credits: 200 },
  { keywords: ["jump_sfx", "sound_jump"], filesMustExist: [], area: "engineering/audio", subarea: "sfx", credits: 50 },
  { keywords: ["hurt_sfx", "sound_hurt"], filesMustExist: [], area: "engineering/audio", subarea: "sfx", credits: 50 },
  { keywords: ["land_sfx", "sound_land"], filesMustExist: [], area: "engineering/audio", subarea: "sfx", credits: 50 },
];

// ─── Ticket Templates ─────────────────────────────────────────────────────────

interface TicketTemplate {
  title: string;
  description: string;
  area: string;
  subarea: string;
  credits: number;
}

const TICKET_TEMPLATES: Record<string, TicketTemplate> = {
  hazards: {
    title: "Add hazard elements (spikes, pits) to the platformer",
    description: `Implement hazard elements for pixel-platformer-1:

1. Add a Spike scene (scenes/hazards/spike.tscn):
   - StaticBody2D with collision shape
   - Appropriate collision_layer to damage player

2. Add hazard detection to player_controller.gd:
   - Connect to hazard area entered signal
   - Trigger damage / death on contact

3. Add spike tiles to level_01.tscn

Acceptance: Player dies when touching spikes, respawns at last checkpoint.`,
    area: "engineering/gameplay",
    subarea: "hazards",
    credits: 150,
  },
  health_ui: {
    title: "Add player health bar UI to game",
    description: `Implement health bar UI for pixel-platformer-1:

1. Create health_bar.tscn UI scene:
   - TextureProgressBar for health display
   - Position in top-left of game_ui

2. Connect to game_state.gd health system

3. Add to game_ui.tscn

4. Visual: health bar animates on damage

Acceptance: Health bar visible during gameplay, updates on damage.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
  },
  bounce_pad: {
    title: "Add spring/bounce pad mechanic",
    description: `Implement bounce pad for pixel-platformer-1:

1. Create bounce_pad.tscn:
   - Area2D for detection
   - Animated sprite
   - Particles on bounce

2. Implement bounce_pad.gd:
   - Apply upward velocity impulse on contact
   - Configurable bounce force (export var)
   - Play spring sound

3. Place in level_01

Acceptance: Player bounces higher when landing on spring pads.`,
    area: "engineering/gameplay",
    subarea: "physics",
    credits: 100,
  },
  level_02: {
    title: "Build Level 02 with increasing difficulty",
    description: `Create level_02.tscn for pixel-platformer-1:

1. Create new tilemap scene:
   - More complex layout than level_01
   - Moving platforms section
   - Spike hazards
   - Combination of all elements

2. Progressive difficulty:
   - Section 1: Simple platforming
   - Section 2: Moving platforms
   - Section 3: Spikes + tight jumps

3. Add gems and enemies throughout
4. Connect to game_manager for level progression

Acceptance: Playable level that takes 2-4 minutes.`,
    area: "engineering/level-design",
    subarea: "levels",
    credits: 200,
  },
  main_menu: {
    title: "Implement main menu scene with start button",
    description: `Implement main menu for pixel-platformer-1:

1. Review existing main_menu.tscn and main_menu.gd

2. Main menu should have:
   - Game title
   - Start Game button -> loads level_01
   - Quit button

3. Connect signals:
   - Start -> game_manager.load_level("res://scenes/levels/level_01.tscn")
   - Quit -> get_tree().quit()

4. Style consistently with game aesthetic

5. Ensure main.tscn loads main_menu on start

Acceptance: Main menu displays on game start, Start loads level_01.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
  },
  coin_score: {
    title: "Add coin and score display system",
    description: `Implement coin/score tracking for pixel-platformer-1:

1. Create coin.tscn:
   - Visual coin sprite (gold, circular)
   - Area2D for collection
   - Plays collect sound

2. Track score in game_state.gd:
   - coins_collected counter
   - Score in game_ui

3. Update game_ui.tscn:
   - Coins display
   - Update on collection

4. Place coins throughout level_01

Acceptance: Coins visible, collected on touch, counter updates.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
  },
  pause_menu: {
    title: "Add pause menu functionality",
    description: `Implement pause menu for pixel-platformer-1:

1. Create pause_menu.tscn:
   - Darkened overlay
   - Paused text
   - Resume button
   - Restart Level button
   - Quit to Main Menu button

2. Implement pause_menu.gd:
   - Resume: get_tree().paused = false
   - Restart: reload current level
   - Quit: return to main_menu

3. Connect to Escape key

Acceptance: Escape pauses game, menu appears, Resume continues.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
  },
  game_complete: {
    title: "Implement game complete / credits screen",
    description: `Implement game complete screen for pixel-platformer-1:

1. Review existing game_complete.tscn

2. Screen should have:
   - Congratulations message
   - Final stats: time, coins, deaths
   - Play Again button -> level_01
   - Main Menu button

3. Connect to game_manager:
   - Triggered on final level completion

4. Add celebratory effects: particles, fanfare

Acceptance: Game complete shows after final level, Play Again restarts.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 150,
  },
  flying_enemy: {
    title: "Add flying enemy type",
    description: `Implement flying enemy for pixel-platformer-1:

1. Create flying_enemy.tscn:
   - CharacterBody2D or RigidBody2D
   - Animated sprite for flight
   - Collision shape

2. Create flying_enemy.gd:
   - Horizontal patrol pattern
   - Optional: sine wave vertical motion
   - Damages player on contact

3. Add to level_02:
   - Place in vertical spaces

4. Visual: flying sprite (bat/ghost style)

Acceptance: Flying enemy moves in patrol, damages player on contact.`,
    area: "engineering/gameplay/enemies",
    subarea: "ai",
    credits: 200,
  },
  ladder: {
    title: "Add ladder and climbing mechanic",
    description: `Implement ladder climbing for pixel-platformer-1:

1. Create ladder.tscn:
   - Area2D for detection
   - Visual ladder sprite

2. Add to player_controller.gd:
   - Detect ladder entered -> climb mode
   - W/Up climb up, S/Down climb down
   - Disable gravity while climbing
   - Exit ladder at top/bottom

3. Add to level_01 or level_02

Acceptance: Player climbs up/down ladders.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 150,
  },
  dash: {
    title: "Add dash/dodge move to player",
    description: `Implement dash move for pixel-platformer-1:

1. Add to player_controller.gd:
   - New dash state
   - Shift or K to dash
   - Horizontal velocity burst (3-4x speed)
   - Duration: 0.15s
   - Cooldown: 0.5s
   - Brief invulnerability during dash
   - Visual: afterimage or blur

2. Stamina cost if applicable

3. Add dash animation state

Acceptance: Player dashes horizontally with invulnerability frames.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 150,
  },
  save_system: {
    title: "Implement save/load system for game progress",
    description: `Implement save system for pixel-platformer-1:

1. Create save_system.gd autoload:
   - Save data: current level, coins, lives, checkpoint
   - Use Godot ConfigFile for persistence
   - Save on: level complete, checkpoint reached

2. Load on game start:
   - Check for save file
   - Resume from last checkpoint

3. UI: Save option in pause menu, New Game resets

Acceptance: Progress persists across game restarts.`,
    area: "engineering",
    subarea: "persistence",
    credits: 200,
  },
  jump_sfx: {
    title: "Add jump sound effect",
    description: `Add jump sound effect for pixel-platformer-1:

1. Add jump sound file to assets/audio/

2. Update player_controller.gd or SfxManager:
   - Play sound on jump
   - Different sound on wall jump

3. Call SfxManager.play_jump() on jump

Acceptance: Jump sound plays when player jumps.`,
    area: "engineering/audio",
    subarea: "sfx",
    credits: 50,
  },
  hurt_sfx: {
    title: "Add hurt/damage sound effect",
    description: `Add hurt sound effect for pixel-platformer-1:

1. Add hurt sound file to assets/audio/

2. Update player_controller.gd or event handling:
   - Play hurt sound when player takes damage
   - Different sound on death

3. Connect to Events.player_damaged

Acceptance: Hurt sound plays on damage.`,
    area: "engineering/audio",
    subarea: "sfx",
    credits: 50,
  },
  land_sfx: {
    title: "Add landing sound effect",
    description: `Add landing sound effect for pixel-platformer-1:

1. Add land sound file to assets/audio/

2. Update player_controller.gd:
   - Play sound when player lands
   - Different based on fall distance

Acceptance: Land sound plays when player lands.`,
    area: "engineering/audio",
    subarea: "sfx",
    credits: 50,
  },
  double_jump: {
    title: "Implement double jump ability",
    description: `Implement double jump for pixel-platformer-1:

1. Update player_controller.gd:
   - Allow second jump in mid-air
   - Jump counter: 0 on ground, 1 in air, reset on land
   - Visual cue: small dust puff on second jump
   - Different animation for double jump

2. Tune jump height (slightly lower than first jump)

Acceptance: Player can jump once, then once more in mid-air before landing.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 100,
  },
  wall_slide: {
    title: "Add wall slide mechanic",
    description: `Implement wall slide for pixel-platformer-1:

1. Update player_controller.gd:
   - Detect touching wall while airborne
   - Slow vertical descent (gravity * 0.3)
   - W/S or Up/Down can increase/decrease slide speed
   - Reset jump counter on wall contact

2. Add wall slide dust particles

3. Add wall slide sound (rubbing/scrape)

Acceptance: Player slides slowly down walls, can wall jump.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 100,
  },
  crouch_slide: {
    title: "Add crouch and slide mechanic",
    description: `Implement crouch/slide for pixel-platformer-1:

1. Update player_controller.gd:
   - Down/S key toggles crouch
   - Crouch: reduce collision height, slower movement
   - Slide: running + crouch = speed burst forward
   - Cannot crouch while airborne

2. Update collision shape for crouch

3. Add crouch animation state

Acceptance: Player crouches under obstacles, slides forward when running and crouching.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 100,
  },
  moving_platform_variety: {
    title: "Add moving platform variety (vertical and diagonal)",
    description: `Add more moving platform types for pixel-platformer-1:

1. Create vertical_moving_platform.tscn:
   - Same pattern as moving_platform.tscn
   - Moves up/down instead of left/right
   - Configurable range and speed

2. Create diagonal_moving_platform.tscn:
   - Moves in diagonal pattern
   - Configurable angle and range

3. Update existing moving_platform.gd to support multiple directions

4. Add all types to level_02

Acceptance: Level has horizontal, vertical, and diagonal moving platforms.`,
    area: "engineering/gameplay",
    subarea: "physics",
    credits: 100,
  },
  key_door: {
    title: "Add key and locked door mechanic",
    description: `Implement key and locked door for pixel-platformer-1:

1. Create key.tscn:
   - Visual key sprite (gold key shape)
   - Area2D for collection
   - Plays pickup sound
   - Particle effect on collect

2. Create locked_door.tscn:
   - Sprite with lock visual
   - Area2D for collision
   - Opens when player has key

3. Update game_state.gd:
   - Track keys collected
   - Key count in UI

4. Add to level_02: key in hard-to-reach area, door blocks shortcut

Acceptance: Key unlocks door, shortcut becomes available.`,
    area: "engineering/gameplay",
    subarea: "gameplay",
    credits: 150,
  },
  portal_finish: {
    title: "Add portal/finish gate level completion",
    description: `Implement portal finish gate for pixel-platformer-1:

1. Create portal.tscn:
   - Animated portal sprite (swirling effect)
   - Area2D trigger
   - Particle effects (glow, sparkle)

2. Create portal.gd:
   - Trigger level_complete on player entry
   - Play completion fanfare
   - Optional: show time/score before transition

3. Add to level_02 end position

Acceptance: Portal visible at level end, triggers victory screen on contact.`,
    area: "engineering/gameplay",
    subarea: "gameplay",
    credits: 100,
  },
  water_hazard: {
    title: "Add water/lava hazard zones",
    description: `Implement water/lava hazard zones for pixel-platformer-1:

1. Create water_zone.tscn:
   - Area2D for hazard detection
   - Animated water/lava sprite
   - Particles (bubbles for water, embers for lava)

2. Create water_zone.gd:
   - Slow player movement while submerged
   - Drain health over time if lava
   - Visual: screen tints slightly

3. Add to level_02 as environmental hazard

Acceptance: Water/lava damages player, creates interesting level hazard.`,
    area: "engineering/gameplay",
    subarea: "hazards",
    credits: 150,
  },
  ground_enemy_patrol: {
    title: "Add ground patrol enemy type",
    description: `Implement ground patrol enemy for pixel-platformer-1:

1. Create patrol_enemy.tscn:
   - CharacterBody2D
   - Animated sprite (walk cycle)
   - Collision shape

2. Create patrol_enemy.gd:
   - Walk back and forth between two points
   - Turn around at edges or walls
   - Damages player on contact
   - Dies when stomped (optional)

3. Add to level_02

Acceptance: Enemy walks back and forth, damages player.`,
    area: "engineering/gameplay/enemies",
    subarea: "ai",
    credits: 150,
  },
  bounce_enemy: {
    title: "Add bouncing enemy type",
    description: `Implement bouncing enemy for pixel-platformer-1:

1. Create bounce_enemy.tscn:
   - CharacterBody2D or RigidBody2D
   - Animated sprite

2. Create bounce_enemy.gd:
   - Moves in one direction
   - Bounces off walls
   - Bounces off platforms
   - Damages player on contact

3. Add to level_02

Acceptance: Enemy bounces around level unpredictably, damages player.`,
    area: "engineering/gameplay/enemies",
    subarea: "ai",
    credits: 150,
  },
  timer_system: {
    title: "Add speedrun timer display",
    description: `Implement speedrun timer for pixel-platformer-1:

1. Update game_ui.tscn:
   - Add timer label (top-right)
   - Format: MM:SS.ms

2. Update game_state.gd:
   - Track elapsed time from level start
   - Reset on death or level restart
   - Display final time on level complete

3. Show personal best on game complete

Acceptance: Timer visible during gameplay, shown on level/game complete.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 75,
  },
  combo_system: {
    title: "Add combo counter for coins and kills",
    description: `Implement combo system for pixel-platformer-1:

1. Update game_state.gd:
   - Combo counter: increments on coin/kill
   - Combo timer (3 seconds)
   - Combo multiplier for score

2. Update game_ui.tscn:
   - Combo display: "x2", "x3", etc.
   - Animate combo counter
   - Flash effect on combo increase

3. Combo breaks on taking damage or timer expiry

Acceptance: Rapid collection increases combo multiplier shown in UI.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
  },
  death_counter: {
    title: "Add death counter display",
    description: `Implement death counter for pixel-platformer-1:

1. Update game_state.gd:
   - Track total deaths across session
   - Store in save file

2. Update game_ui.tscn:
   - Skull icon + death count
   - Position: below health bar or in corner

3. Show on game complete screen

Acceptance: Death counter visible, persists across levels.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 50,
  },
  parallax_background_2: {
    title: "Add second parallax background layer",
    description: `Add second parallax layer for pixel-platformer-1:

1. Create parallax_layer_2.tscn:
   - ParallaxLayer2D with new background image
   - Different scroll speed (0.3 instead of 0.5)

2. Add new background asset:
   - Mountains or clouds silhouette
   - Darker/more muted than foreground

3. Add to level_01.tscn and level_02.tscn

Acceptance: Two parallax layers visible, creates depth.`,
    area: "engineering/gameplay",
    subarea: "visual-effects",
    credits: 75,
  },
  level_03: {
    title: "Build Level 03 with boss encounter",
    description: `Create level_03.tscn for pixel-platformer-1:

1. Create new tilemap scene:
   - Most challenging level yet
   - Requires mastery of all mechanics
   - Multiple paths (easy/hard)

2. Include all elements:
   - Moving platforms (all types)
   - Hazards (spikes, water)
   - Enemies (patrol + flying)
   - Keys and locked doors
   - Ladders

3. Boss encounter at end:
   - Stationary enemy with attack patterns
   - Requires dodging and timing
   - Health bar for boss

Acceptance: Challenging level with boss, takes 5-8 minutes.`,
    area: "engineering/level-design",
    subarea: "levels",
    credits: 300,
  },
  ambient_particles: {
    title: "Add ambient floating particles to levels",
    description: `Add ambient particles for pixel-platformer-1:

1. Create ambient_particles.tscn:
   - CPUParticles2D with slow-moving dust/firefly pattern
   - Soft white/yellow color
   - Low density

2. Add to level_01.tscn and level_02.tscn:
   - Place in quiet areas
   - Behind player layer (foreground particles optional)

3. Tweak: count=30, lifetime=4, speed=10

Acceptance: Subtle floating particles visible throughout levels.`,
    area: "engineering/gameplay",
    subarea: "visual-effects",
    credits: 50,
  },

  // ── New Features (Batch 3) ────────────────────────────────────────────────
  wall_jump: {
    title: "Add wall jump mechanic",
    description: `Implement wall jump for pixel-platformer-1:

1. Update player_controller.gd:
   - Detect wall contact while in air (raycast or collision)
   - Allow jumping off wall in opposite direction
   - Wall jump velocity: higher horizontal push than regular jump
   - Short cooldown to prevent infinite wall climbing

2. Add wall jump state to movementsm

3. Add wall jump particle effect

Acceptance: Player can jump off walls to reach higher platforms.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 100,
  },
  wall_kick: {
    title: "Add wall kick mechanic",
    description: `Implement wall kick for pixel-platformer-1:

1. Update player_controller.gd:
   - Kick off wall while sliding with directional input away from wall
   - Brief invulnerability during kick
   - Velocity boost in kick direction

2. Visual: kick dust particles, brief sprite flash

Acceptance: Player can kick off walls for additional mobility options.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 100,
  },
  moving_enemy: {
    title: "Add moving enemy type",
    description: `Implement a patrolling enemy type for pixel-platformer-1:

1. Create scenes/enemies/patrol_enemy.gd:
   - Walk back and forth between two points
   - Reverse direction at edges or walls
   - Player collision = damage player

2. Create scenes/enemies/patrol_enemy.tscn with AnimatedSprite2D

3. Add instances to level_01 and level_02

Acceptance: Enemy patrols set path and damages player on contact.`,
    area: "engineering/gameplay",
    subarea: "enemies",
    credits: 150,
  },
  moving_coin: {
    title: "Add moving/flying coin collectible",
    description: `Implement moving coins for pixel-platformer-1:

1. Create scenes/collectibles/flying_coin.gd:
   - Float in sine wave pattern or circular motion
   - Collectible on player contact
   - Coin sound on collect

2. Create scenes/collectibles/flying_coin.tscn with AnimatedSprite2D

3. Place in levels for dynamic collectible challenge

Acceptance: Coins move in predictable patterns and are collectible.`,
    area: "engineering/gameplay",
    subarea: "collectibles",
    credits: 100,
  },
  animated_tiles: {
    title: "Add animated tile support",
    description: `Implement animated tiles for pixel-platformer-1:

1. Create tile set entries with AnimatedSprite2D:
   - Waterfall/waves tiles
   - Lava bubbles
   - Torch/fire tiles

2. Configure animation speed and loop

3. Update tile set in levels

Acceptance: Animated tiles play in tile map without manual sprite animation setup.`,
    area: "engineering/art",
    subarea: "visual",
    credits: 100,
  },
  moving_platform_diagonal: {
    title: "Add diagonal moving platforms",
    description: `Implement diagonal moving platforms for pixel-platformer-1:

1. Update moving_platform.gd:
   - Support diagonal direction vectors
   - Configurable angle and speed

2. Add diagonal path platforms to level_02

3. Test player rides platform correctly

Acceptance: Diagonal platforms move smoothly and carry player.`,
    area: "engineering/gameplay",
    subarea: "physics",
    credits: 100,
  },
  ladder_mechanic: {
    title: "Add ladder climb mechanic",
    description: `Implement ladder climbing for pixel-platformer-1:

1. Create scenes/objects/ladder.tscn (Area2D + CollisionShape2D)

2. Update player_controller.gd:
   - Detect ladder overlap
   - Climb up/down with input
   - Disable gravity while on ladder
   - Jump off ladder

3. Add ladder instances to level_02

Acceptance: Player can climb up and down ladders, jump off them.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 150,
  },
  rope_swing: {
    title: "Add rope swing mechanic",
    description: `Implement rope swinging for pixel-platformer-1:

1. Create scenes/objects/rope.tscn:
   - Rope anchor point at ceiling
   - Rope line rendered with Line2D
   - Player attaches to rope on contact

2. Update player physics when attached:
   - Pendulum swing with input
   - Release with jump

3. Add to level_03

Acceptance: Player can swing on rope and release to jump.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 150,
  },
  checkpoint_visual: {
    title: "Add checkpoint visual indicator",
    description: `Add visual feedback for checkpoints in pixel-platformer-1:

1. Update checkpoint.gd:
   - Play flag raise animation on activation
   - Particle burst effect
   - Flag color change

2. Update checkpoint.tscn with AnimatedSprite2D

3. Add to all levels

Acceptance: Checkpoint activation is clearly visible to player.`,
    area: "engineering/gameplay",
    subarea: "visual-effects",
    credits: 50,
  },
  level_transition: {
    title: "Add level transition effect",
    description: `Implement level transitions for pixel-platformer-1:

1. Create scenes/ui/level_transition.tscn:
   - Fade to black on level exit
   - Fade from black on level enter

2. Update level scripts to trigger transition

3. Add to portal/finish gate

Acceptance: Smooth fade between levels, no jarring cuts.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
  },
  player_sprite_flip: {
    title: "Add player sprite flip animation polish",
    description: `Polish player sprite flipping in pixel-platformer-1:

1. Update player_controller.gd:
   - Smooth sprite flip on direction change
   - Facing direction used for aim-related features

2. Add brief squash/stretch on direction change

3. Test with dash and wall slide

Acceptance: Sprite flips instantly but smoothly, no animation jank.`,
    area: "engineering/gameplay",
    subarea: "visual-effects",
    credits: 50,
  },
  coyote_time: {
    title: "Add coyote time to player jump",
    description: `Implement coyote time for pixel-platformer-1:

1. Update player_controller.gd:
   - Allow jump for ~100ms after leaving platform
   - Track time since last grounded
   - Reset on landing

2. Tune timing for feel

3. Test with edge jumps

Acceptance: Player can jump briefly after walking off a platform.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 50,
  },
  jump_buffer: {
    title: "Add jump input buffering",
    description: `Implement jump buffering for pixel-platformer-1:

1. Update player_controller.gd:
   - Buffer jump input for ~100ms before landing
   - Execute buffered jump on land

2. Test with approach jumps

Acceptance: Jump registers even if pressed slightly before landing.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 50,
  },
  invincibility_frames: {
    title: "Add invincibility frames on damage",
    description: `Implement i-frames for pixel-platformer-1:

1. Update player_controller.gd:
   - On damage: set i-frames for 1.5s
   - Sprite flicker/blink during i-frames
   - Disable collision with hazards during i-frames

2. Test hazard collision during i-frames

Acceptance: Player flashes and is briefly immune after taking damage.`,
    area: "engineering/gameplay",
    subarea: "combat",
    credits: 100,
  },
  // ─── Batch 4 ────────────────────────────────────────────────────────────────
  screen_shake: {
    title: "Add screen shake on damage and explosions",
    description: `Implement screen shake for pixel-platformer-1:

1. Create a screen_shake.gd utility or Camera2D extension:
   - Shake intensity and duration parameters
   - Trauma-based shake (add trauma, decay over time)
   - Configurable for: player damage, enemy death, explosions

2. Integrate with player_controller.gd:
   - Shake on player taking damage
   - Shake on enemy death nearby

3. Add to boss encounters for impact

Acceptance: Camera shakes on significant events, feels impactful.`,
    area: "engineering/gameplay",
    subarea: "visual-effects",
    credits: 75,
  },
  wall_climb: {
    title: "Add wall climb ability (climb up walls)",
    description: `Implement wall climbing for pixel-platformer-1:

1. Update player_controller.gd:
   - When touching wall and holding toward wall, enter climb state
   - Climb up/down with W/S or Up/Down input
   - Disable gravity while climbing
   - Jump off wall to detach
   - Climb speed configurable

2. Add climb animation state
   - AnimatedSprite or sprite rotation during climb

Acceptance: Player can climb up vertical walls by holding toward them.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 100,
  },
  dash_cooldown_ui: {
    title: "Add dash cooldown indicator to UI",
    description: `Add visual cooldown feedback for dash in pixel-platformer-1:

1. Update game_ui.gd or game_ui.tscn:
   - Dash cooldown icon (circle or bar)
   - Fill animation as cooldown resets
   - Grayed out when on cooldown
   - Flash when ready

2. Update player_controller.gd:
   - Emit signal or update UI when dash becomes available

Acceptance: Player can see when dash is ready via UI indicator.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 50,
  },
  collectible_map: {
    title: "Add level collectible completion tracker",
    description: `Implement level completion tracking for pixel-platformer-1:

1. Update game_state.gd:
   - Track total collectibles per level
   - Track collected count
   - Calculate percentage

2. Update game_ui.gd:
   - Show collectible count: "12/20 gems"
   - Or show mini progress bar

3. Store in save file

Acceptance: Player sees progress toward collecting all items in a level.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 50,
  },
  moving_spike_hazard: {
    title: "Add moving spike trap hazard",
    description: `Implement moving spike traps for pixel-platformer-1:

1. Create moving_spike.tscn:
   - Area2D for detection
   - Animated sprite for spikes
   - CollisionShape2D for hazard

2. Create moving_spike.gd:
   - Patrol between two points
   - Toggle spikes extended/retracted
   - Speed configurable

3. Add to level_02 or level_03

Acceptance: Spike traps move and extend/retract, damaging player on contact.`,
    area: "engineering/gameplay",
    subarea: "hazards",
    credits: 100,
  },
  spring_pad: {
    title: "Add spring pad bounce mechanism",
    description: `Implement spring bounce pads for pixel-platformer-1:

1. Create spring_pad.tscn:
   - Area2D for detection
   - Animated sprite (compressed/extended)
   - CollisionShape2D

2. Create spring_pad.gd:
   - Detect player entering
   - Apply upward velocity burst
   - Play spring animation
   - Play sound

3. Add to level_02 or level_03

Acceptance: Spring pads launch player to higher platforms.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 75,
  },
  secret_area_hint: {
    title: "Add visual hint system for secret areas",
    description: `Implement secret area reveals for pixel-platformer-1:

1. Create secret_wall or breakable_wall.tscn:
   - Sprite that looks slightly different from normal wall
   - Particle dust effect when near

2. Update player_controller.gd:
   - When player stands near secret area, show subtle particle hint

3. Add secret areas to level_01 or level_02:
   - Hidden alcove with bonus coins

Acceptance: Attentive players can spot potential secret areas.`,
    area: "engineering/gameplay",
    subarea: "gameplay",
    credits: 75,
  },
  dynamic_music: {
    title: "Add dynamic music that intensifies during danger",
    description: `Implement dynamic music system for pixel-platformer-1:

1. Create music_manager.gd autoload or update AudioManager:
   - Track player health state (full, damaged, critical)
   - Crossfade between calm and danger music layers
   - BPM/speed increase at low health

2. Add danger layer audio files (or toggle sections):
   - Calm background loop
   - Intense action loop

3. Wire to player health changes via EventBus

Acceptance: Music becomes more tense as player health decreases.`,
    area: "engineering/audio",
    subarea: "music",
    credits: 100,
  },
  achievement_system: {
    title: "Add achievement/badge unlock system",
    description: `Implement achievements for pixel-platformer-1:

1. Create achievement.gd:
   - Achievement definitions (id, title, description, icon)
   - Check conditions: kills, deaths, time, collectibles

2. Update game_state.gd:
   - Track achievement progress
   - Emit unlock event

3. Create achievement_popup.tscn:
   - Toast notification when unlocked
   - Add to save data

4. Add achievements: "First Blood", "Speedrunner", "Completionist", etc.

Acceptance: Achievements unlock and display as player progresses.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
  },
  local_leaderboard: {
    title: "Add local high score and time leaderboard",
    description: `Implement local leaderboard for pixel-platformer-1:

1. Create leaderboard.gd:
   - Store top 10 scores per level
   - Store best times
   - Use ConfigFile for persistence

2. Create leaderboard.tscn UI:
   - Show rank, name, score, time
   - Input name on new high score

3. Update game_complete screen:
   - Submit score to leaderboard
   - Show if player made top 10

Acceptance: Players can see and compete for local high scores.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
  },
  falling_lava: {
    title: "Add falling lava balls hazard",
    description: `Implement falling lava hazard for pixel-platformer-1:

1. Create falling_lava.tscn:
   - Area2D trigger above
   - Animated lava ball sprite

2. Create falling_lava.gd:
   - Spawn lava balls at intervals from ceiling
   - Fall with gravity
   - Destroy on ground impact or after timeout
   - Damage player on contact

3. Add to level_03

Acceptance: Lava balls fall from ceiling, player must dodge.`,
    area: "engineering/gameplay",
    subarea: "hazards",
    credits: 75,
  },
  moving_platform_vertical: {
    title: "Add vertical moving platforms",
    description: `Implement vertical moving platforms for pixel-platformer-1:

1. Update moving_platform.gd or create vertical_moving_platform.gd:
   - Support up/down movement
   - Configurable range and speed
   - Smooth start/stop

2. Create vertical_moving_platform.tscn if separate

3. Add to level_02 or level_03

Acceptance: Platforms move up and down, player can ride them.`,
    area: "engineering/gameplay",
    subarea: "physics",
    credits: 75,
  },
  camera_bounds: {
    title: "Add camera bounds limits to prevent seeing outside levels",
    description: `Fix camera bounds for pixel-platformer-1:

1. Update Camera2D in player.tscn or level scenes:
   - Set limit_left, limit_right, limit_top, limit_bottom
   - Match to level tilemap boundaries
   - Enable drag_margin_h/v as needed

2. Ensure no black void is visible at level edges

3. Test across all levels

Acceptance: Camera stops at level boundaries, no void visible.`,
    area: "engineering/gameplay",
    subarea: "camera",
    credits: 50,
  },
  squash_stretch: {
    title: "Add squash and stretch animation to player movement",
    description: `Implement squash and stretch for pixel-platformer-1:

1. Update player_controller.gd:
   - Scale sprite: stretch on jump, squash on land
   - Use tween for smooth animation
   - Reset to normal scale after brief duration

2. Add to: jump, land, wall jump, dash start, dash end

3. Tune amounts for feel

Acceptance: Player sprite squashes and stretches for juicy feel.`,
    area: "engineering/gameplay",
    subarea: "visual-effects",
    credits: 75,
  },
  enemy_patrol_path: {
    title: "Add patrol path editor for enemies (waypoint system)",
    description: `Implement waypoint patrol for pixel-platformer-1:

1. Create patrol_path.tscn:
   - Line2D showing patrol route
   - Marker2D nodes for waypoints

2. Update patrol_enemy.gd:
   - Reference patrol_path
   - Move through waypoints sequentially
   - Loop or reverse at end
   - Configurable wait time at each waypoint

3. Test with multiple enemies on same path

Acceptance: Enemies follow editor-defined patrol paths with waypoints.`,
    area: "engineering/gameplay",
    subarea: "ai",
    credits: 100,
  },
  // ─── Batch 5 ────────────────────────────────────────────────────────────────
  particle_gun: {
    title: "Add collectible power-up items",
    description: `Implement collectible power-ups for pixel-platformer-1:

1. Create powerup.tscn:
   - Area2D + AnimatedSprite2D
   - Glow/pulse animation
   - Types: speed boost, shield, double jump

2. Create powerup.gd:
   - Detect player collection
   - Apply temporary buff via EventBus
   - Despawn after collection

3. Add to levels scattered in challenging spots

Acceptance: Collectible power-ups grant temporary abilities.`,
    area: "engineering/gameplay",
    subarea: "collectibles",
    credits: 100,
  },
  throw_attack: {
    title: "Add melee throw attack ability",
    description: `Implement melee throw attack for pixel-platformer-1:

1. Update player_controller.gd:
   - New attack state
   - K key or click triggers throw
   - Spawn projectile in facing direction
   - Cooldown between throws
   - Limited ammo or recharge

2. Create projectile.tscn if needed

3. Add throw animation state

Acceptance: Player can throw projectiles in facing direction.`,
    area: "engineering/gameplay",
    subarea: "combat",
    credits: 100,
  },
  minimap: {
    title: "Add minimap UI overlay",
    description: `Add minimap display for pixel-platformer-1:

1. Create minimap.gd or update game_ui.gd:
   - Render level overview in corner
   - Show player position as dot
   - Show enemy positions as red dots
   - Show collectibles as yellow dots

2. Create minimap.tscn:
   - Small viewport or TextureRect
   - Semi-transparent background
   - Position: top-right corner

3. Add to game_ui.tscn

Acceptance: Minimap visible in corner showing level overview.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 75,
  },
  frozen_enemy: {
    title: "Add freeze effect that stuns enemies temporarily",
    description: `Implement freeze/stun mechanic for pixel-platformer-1:

1. Create freeze_effect.gd:
   - Emit signal to freeze enemies in area
   - Timer for duration

2. Update enemy scripts:
   - Listen for freeze event
   - Disable AI movement while frozen
   - Visual: ice tint or pause animation

3. Could be triggered by: collectible, player attack, environmental

Acceptance: Enemies freeze in place temporarily when triggered.`,
    area: "engineering/gameplay",
    subarea: "combat",
    credits: 75,
  },
  slow_motion: {
    title: "Add slow-motion ability on player damage",
    description: `Implement slow-motion on hit for pixel-platformer-1:

1. Create slowmo.gd utility:
   - Slow game speed to 0.3x for 0.5s
   - Smooth ease in/out
   - Screen tint blue briefly

2. Integrate with player_controller.gd:
   - Trigger on player taking damage
   - Brief window to react

Acceptance: Game slows briefly when player is damaged.`,
    area: "engineering/gameplay",
    subarea: "visual-effects",
    credits: 75,
  },
  backdash: {
    title: "Add backdash dodge move",
    description: `Implement backdash for pixel-platformer-1:

1. Update player_controller.gd:
   - Shift+away triggers backdash
   - Quick backward dash
   - Brief invulnerability frames
   - Slower than forward dash

2. Add backdash animation state

3. Add screen shake on backdash

Acceptance: Player can dodge backward with brief invincibility.`,
    area: "engineering/gameplay",
    subarea: "movement",
    credits: 75,
  },
  player_health_upgrade: {
    title: "Add max health upgrade collectible",
    description: `Implement max health upgrade for pixel-platformer-1:

1. Create health_upgrade.tscn:
   - Heart or potion sprite
   - Glow effect
   - Area2D for collection

2. Update player_controller.gd or game_state.gd:
   - Increase max health on collect
   - Restore some health too
   - Update UI health display

3. Place sparingly in levels

Acceptance: Collecting health upgrade increases max health.`,
    area: "engineering/gameplay",
    subarea: "gameplay",
    credits: 75,
  },
  gravity_zone: {
    title: "Add gravity inversion zones",
    description: `Implement gravity flip zones for pixel-platformer-1:

1. Create gravity_zone.tscn:
   - Area2D for detection
   - Arrow indicators

2. Create gravity_zone.gd:
   - Toggle player gravity direction
   - Walk on ceiling when inverted
   - Visual cue when inside zone

3. Add to level_03 for puzzle challenge

Acceptance: Player walks on ceiling inside gravity zones.`,
    area: "engineering/gameplay",
    subarea: "hazards",
    credits: 100,
  },
  dash_trail: {
    title: "Add dash trail afterimage effect",
    description: `Implement dash afterimages for pixel-platformer-1:

1. Update player_controller.gd:
   - During dash, spawn ghost sprites at intervals
   - Ghosts fade out over 0.3s
   - 3-5 afterimages per dash

2. Create afterimage.gd:
   - Sprite with decreasing alpha
   - Position follows dash path

Acceptance: Visible afterimage trail follows player during dash.`,
    area: "engineering/gameplay",
    subarea: "visual-effects",
    credits: 75,
  },
  ambient_sounds: {
    title: "Add ambient background sounds per level",
    description: `Implement ambient soundscapes for pixel-platformer-1:

1. Update level scenes:
   - Add ambient AudioStreamPlayer
   - Different ambient per level (forest, cave, lava)

2. Create ambient_audio.gd:
   - Fade in/out on level enter/exit
   - Looping gentle sounds

3. Add ambient audio files per level theme

Acceptance: Each level has distinct ambient sound background.`,
    area: "engineering/audio",
    subarea: "sfx",
    credits: 50,
  },
  moving_coin_pattern: {
    title: "Add coin collectible pattern paths (figure-8, sine wave)",
    description: `Implement moving coin patterns for pixel-platformer-1:

1. Create coin_path.tscn:
   - Path2D with coin instances along it
   - Coins follow path

2. Create coin_path.gd:
   - Move coins along Path2D
   - Loop continuously
   - Collection detection

3. Add to level_02 or level_03

Acceptance: Coins move in patterns like figure-8 or sine wave.`,
    area: "engineering/gameplay",
    subarea: "collectibles",
    credits: 75,
  },
  enemy_spawner: {
    title: "Add enemy spawner that creates enemies over time",
    description: `Implement enemy spawner for pixel-platformer-1:

1. Create enemy_spawner.tscn:
   - Marker2D for spawn point
   - Visual spawner device sprite

2. Create enemy_spawner.gd:
   - Timer to spawn enemies
   - Max enemies alive
   - Enemy type configurable
   - Spawn animation (particles)

3. Add to level_02 or level_03

Acceptance: Enemies spawn over time from spawner points.`,
    area: "engineering/gameplay",
    subarea: "ai",
    credits: 100,
  },
  player_feedback_ui: {
    title: "Add on-screen damage direction indicator",
    description: `Implement damage direction indicator for pixel-platformer-1:

1. Update game_ui.gd:
   - When player takes damage, show arrow at screen edge
   - Arrow points toward damage source
   - Fades after 1s

2. Use screen edge markers or directional sprites

Acceptance: Player knows where damage came from.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 50,
  },
  checkpoint_save: {
    title: "Add auto-save at checkpoints with slot system",
    description: `Implement checkpoint save slots for pixel-platformer-1:

1. Update save_system.gd:
   - Multiple save slots (3)
   - Save: level, health, coins, checkpoint
   - Load from pause menu

2. Create save_slot.gd:
   - Track slot data
   - Show slot preview (level name, time)

3. Update pause menu with Continue/New Game options

Acceptance: Player can save/load at checkpoints with multiple slots.`,
    area: "engineering",
    subarea: "persistence",
    credits: 100,
  },
  tutorial_popup: {
    title: "Add contextual tutorial popups for new mechanics",
    description: `Implement tutorial system for pixel-platformer-1:

1. Create tutorial_popup.tscn:
   - Panel with text and icon
   - Arrow pointing to relevant element
   - Dismiss button

2. Create tutorial_manager.gd:
   - Trigger popup when player enters area
   - Track shown tutorials to not repeat
   - Wire to first-time level entrance

3. Add tutorials for: jump, wall jump, dash, collectibles

Acceptance: Contextual tutorials appear for new players.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 75,
  },
  level_select: {
    title: "Add level select screen accessible from main menu",
    description: `Implement level select for pixel-platformer-1:

1. Create level_select.tscn:
   - Grid of level buttons
   - Locked/unlocked states
   - Best time/score shown

2. Create level_select.gd:
   - Load unlocked levels from save
   - Click to load selected level
   - Back button to main menu

3. Update main_menu.gd with Level Select button

Acceptance: Level select screen allows choosing any unlocked level.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
  },
  // ─── Batch 6 ────────────────────────────────────────────────────────────────
  settings_menu: {
    title: "Add settings menu (volume, controls, fullscreen)",
    description: `Implement settings menu for pixel-platformer-1:

1. Create settings_menu.tscn:
   - Volume sliders (music, sfx)
   - Control scheme display
   - Fullscreen toggle
   - Save/load settings

2. Create settings_manager.gd:
   - Store settings in ConfigFile
   - Apply on game start
   - Expose to AudioServer for volume

3. Add Settings button to main menu

Acceptance: Settings persist and affect game immediately.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
  },
  landing_dust: {
    title: "Add landing dust particles on jump land",
    description: `Implement landing dust for pixel-platformer-1:

1. Update player_controller.gd:
   - On land from height, emit particle burst
   - Scale burst with fall distance

2. Create landing_dust.gd:
   - CPUParticles2D radial burst
   - Quick fade (0.3s)

3. Tune for pixel art feel (small particles)

Acceptance: Dust poof on landing proportional to fall height.`,
    area: "engineering/gameplay",
    subarea: "visual-effects",
    credits: 50,
  },
  coin_sparkle: {
    title: "Add sparkle trail on flying coins",
    description: `Add sparkle effect to moving coins in pixel-platformer-1:

1. Update flying_coin.gd:
   - Add sparkle particle trail
   - Slight glow effect

2. Create coin_sparkle.tscn:
   - CPUParticles2D with golden sparkles
   - Follow coin position

3. Trigger sparkle burst on collect

Acceptance: Flying coins leave golden sparkle trail.`,
    area: "engineering/gameplay",
    subarea: "visual-effects",
    credits: 50,
  },
  parallax_sky: {
    title: "Add animated parallax sky background",
    description: `Implement animated sky for pixel-platformer-1:

1. Create animated_sky.tscn:
   - Multiple ParallaxLayer2D
   - Animated clouds (slow drift)
   - Day/night color gradient

2. Update to level scenes:
   - Place behind existing parallax

3. Use AnimatedTexture or sprite animation

Acceptance: Sky with slowly moving clouds visible in levels.`,
    area: "engineering/gameplay",
    subarea: "visual-effects",
    credits: 75,
  },
  hazard_warning: {
    title: "Add visual warning before hazard activates (spikes, spikes)",
    description: `Implement hazard warning system for pixel-platformer-1:

1. Update moving_spike.gd:
   - Flash red before extending
   - Audio cue (whoosh sound)

2. Add hazard_warning.gd:
   - General warning system for all hazards
   - Brief flash before activation

3. Add to spike traps, lava zones, etc.

Acceptance: Hazards visually warn before becoming dangerous.`,
    area: "engineering/gameplay",
    subarea: "hazards",
    credits: 50,
  },
  projectile_deflect: {
    title: "Add deflect mechanic (player can reflect projectiles)",
    description: `Implement projectile deflection for pixel-platformer-1:

1. Update player_controller.gd:
   - Add deflect state
   - Timing window to reflect
   - Reflect in facing direction

2. Update projectile.gd:
   - Check if deflected
   - Reverse direction and increase speed

3. Visual: spark effect on deflect

Acceptance: Player can deflect enemy projectiles back.`,
    area: "engineering/gameplay",
    subarea: "combat",
    credits: 100,
  },
  knockback_weapon: {
    title: "Add knockback effect to player attacks",
    description: `Implement knockback on attacks for pixel-platformer-1:

1. Update player_controller.gd:
   - On attack hit, apply knockback to enemy
   - Direction based on player facing

2. Update enemy scripts:
   - Apply velocity on knockback
   - Brief stun after knockback

3. Tune knockback force per enemy type

Acceptance: Enemies knock back when hit by player.`,
    area: "engineering/gameplay",
    subarea: "combat",
    credits: 75,
  },
  respawn_timer: {
    title: "Add respawn countdown timer display",
    description: `Implement respawn timer for pixel-platformer-1:

1. Update game_ui.gd:
   - On death, show countdown (3, 2, 1)
   - Center screen, large numbers

2. Create respawn_countdown.gd:
   - Timer logic
   - Fade in/out animation

3. Disable player input during countdown

Acceptance: Numbers countdown shown before respawn.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 50,
  },
  pause_blur: {
    title: "Add background blur effect when game pauses",
    description: `Implement pause blur for pixel-platformer-1:

1. Update pause logic:
   - On pause, apply shader to background
   - Gaussian blur shader
   - Dim overlay

2. Create pause_blur.shader:
   - Simple blur effect

3. Remove blur on unpause with fade

Acceptance: Background blurs and dims when pausing.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 50,
  },
  death_screen: {
    title: "Add stylized death screen with retry option",
    description: `Implement death screen for pixel-platformer-1:

1. Create death_screen.tscn:
   - Dark overlay
   - "You Died" text with effect
   - Retry button
   - Quick fade in

2. Create death_screen.gd:
   - Show on player death
   - Track death count

3. Animate: screen tint red briefly, fade to death screen

Acceptance: Death screen appears with retry option.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 50,
  },
  combo_timer_ui: {
    title: "Add visible combo timer bar in UI",
    description: `Add combo timer display for pixel-platformer-1:

1. Update game_ui.gd:
   - Combo timer bar below combo counter
   - Drains over combo duration
   - Refills on each combo hit

2. Animate bar color: green -> yellow -> red

3. Hide bar when combo < 2

Acceptance: Visual timer shows combo window.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 50,
  },
  key_inventory_ui: {
    title: "Add key inventory display in UI",
    description: `Implement key UI for pixel-platformer-1:

1. Update game_ui.gd:
   - Key icons in top-right (or near health)
   - Show collected keys
   - Animate on key collect

2. Update game_state.gd:
   - Track keys collected
   - Max keys per level

3. Add to HUD alongside coins

Acceptance: Key count visible in HUD.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 50,
  },
  pause_control_hints: {
    title: "Add control hints to pause menu",
    description: `Add control reference to pause menu for pixel-platformer-1:

1. Update pause_menu.tscn:
   - Add controls panel
   - List all controls with icons
   - WASD/Jump/Attack/Dash labels

2. Create control_hint.gd:
   - Icon + label pairs
   - Pixel art style icons

3. Scrollable if many controls

Acceptance: Pause menu shows all available controls.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 50,
  },
  wall_slide_particles: {
    title: "Add wall slide dust particles",
    description: `Implement wall slide particle effects for pixel-platformer-1:

1. Create wall_slide_particles.tscn:
   - CPUParticles2D with dust texture
   - Particle direction: downward + outward
   - Lifetime: 0.3-0.5s
   - Emission while wall sliding

2. Update player_controller.gd:
   - Spawn particles on wall contact while falling
   - Position at player's wall contact point
   - Rate based on fall speed

3. Use existing dust particle texture or procedural dots.

Acceptance: Dust particles emit from player's feet during wall slide.`,
    area: "engineering/gameplay/vfx",
    subarea: "particles",
    credits: 100,
  },
  death_animation: {
    title: "Add player death animation sequence",
    description: `Implement player death animation for pixel-platformer-1:

1. Create death effect scene (scenes/vfx/death_effect.tscn):
   - CPUParticles2D explosion (red/orange particles)
   - Screen shake (0.2s)
   - Brief flash overlay

2. Update player_controller.gd:
   - On death: freeze player, play animation, then respawn
   - Death state in state machine
   - Handle fall-death vs enemy-death differently

3. Coordinate with EventBus for death events.

Acceptance: Player plays death animation before respawning at checkpoint.`,
    area: "engineering/gameplay/vfx",
    subarea: "animation",
    credits: 100,
  },
  camera_smooth: {
    title: "Add smooth camera follow with look-ahead",
    description: `Implement smooth camera for pixel-platformer-1:

1. Create camera_follow.gd or update Camera2D setup:
   - Smooth follow with lerp (smoothing: 3-5)
   - Look-ahead: camera leads player direction
   - Vertical offset when jumping/falling
   - Boundaries to prevent seeing beyond level edges

2. Configure in player.tscn:
   - Add Camera2D as child of player
   - Configure limit from tilemap bounds

3. Handle scene transitions: camera reset.

Acceptance: Camera follows player smoothly with look-ahead, no jarring movements.`,
    area: "engineering/gameplay",
    subarea: "camera",
    credits: 100,
  },
  checkpoint_flag: {
    title: "Add checkpoint flag save points",
    description: `Implement checkpoint flags for pixel-platformer-1:

1. Create checkpoint.tscn:
   - Sprite with flag animation (idle, activated)
   - Area2D trigger
   - CollisionShape2D

2. Create checkpoint.gd:
   - On player contact: activate checkpoint
   - Play activation animation (flag raise + particles)
   - Save to SaveSystem
   - Only furthest checkpoint activates

3. Add multiple checkpoints to level_01.

Acceptance: Checkpoint activates on touch, particles play, respawn point updates.`,
    area: "engineering/gameplay",
    subarea: "gameplay",
    credits: 100,
  },
  falling_platform: {
    title: "Add falling/crumbling platform mechanic",
    description: `Implement falling platforms for pixel-platformer-1:

1. Create falling_platform.tscn:
   - StaticBody2D with timer
   - Sprite for platform
   - Warning shake before falling

2. Create falling_platform.gd:
   - On player contact: start timer (0.5s delay)
   - Shake platform during delay
   - After timer: disable collision, apply gravity
   - Respawn after 3s

3. Add to level_02 in tricky areas.

Acceptance: Platform shakes and falls when player stands on it, respawns after delay.`,
    area: "engineering/gameplay",
    subarea: "physics",
    credits: 100,
  },
  bouncy_enemy: {
    title: "Add bouncy slime enemy type",
    description: `Implement bouncy slime enemy for pixel-platformer-1:

1. Create slime_enemy.tscn:
   - CharacterBody2D with animated sprite
   - Squash/stretch animation
   - CollisionShape2D

2. Create slime_enemy.gd:
   - Patrol between two points
   - Bounces up when hitting wall
   - Damages player on contact
   - Squash animation on bounce

3. Add 2-3 to level_02.

Acceptance: Slime bounces between walls, damages player on contact.`,
    area: "engineering/gameplay/enemies",
    subarea: "ai",
    credits: 100,
  },
  disappearing_floor: {
    title: "Add disappearing/reappearing floor tiles",
    description: `Implement disappearing floors for pixel-platformer-1:

1. Create disappearing_platform.tscn:
   - StaticBody2D with tile sprite
   - Timer and state machine

2. Create disappearing_platform.gd:
   - On player contact: start countdown (2s)
   - Platform fades out (opacity animation)
   - Collision disabled
   - Reappears after 4s with fade-in

3. Add to level_02 as timing puzzles.

Acceptance: Platform disappears after player stands on it, reappears after delay.`,
    area: "engineering/gameplay",
    subarea: "physics",
    credits: 100,
  },
  speed_boost: {
    title: "Add speed boost pad/trigger",
    description: `Implement speed boost for pixel-platformer-1:

1. Create speed_boost.tscn:
   - Area2D with arrow sprite
   - Visual: chevron arrows pointing right
   - Particles when active

2. Create speed_boost.gd:
   - On player entry: apply velocity boost
   - Configurable boost multiplier (1.5x - 2x)
   - Duration: 1-2 seconds
   - Optional: dash state

3. Place strategically in levels for shortcuts.

Acceptance: Player accelerates when passing through speed boost pad.`,
    area: "engineering/gameplay",
    subarea: "gameplay",
    credits: 100,
  },
  one_way_platform: {
    title: "Add one-way passthrough platforms",
    description: `Implement one-way platforms for pixel-platformer-1:

1. Update existing platform or create new:
   - CollisionShape2D with one-way setting enabled
   - Visual indicator (arrow pointing down)

2. In player_controller.gd:
   - Only collide when player is falling (velocity.y > 0)
   - Can jump through from below

3. Add to level_01 or level_02 as vertical puzzles.

Acceptance: Player can jump up through platform from below, lands on top.`,
    area: "engineering/gameplay",
    subarea: "physics",
    credits: 100,
  },
  ice_surface: {
    title: "Add ice/slippery surface mechanic",
    description: `Implement ice surfaces for pixel-platformer-1:

1. Create ice_zone.tscn or use tiles:
   - Area2D zone with ice visual
   - TileMap tiles with ice texture

2. Update player_controller.gd:
   - Detect ice zone via Area2D overlap
   - On ice: reduced friction, momentum preserved
   - Player slides when changing direction
   - Different acceleration/deceleration values

3. Add ice sections to level_02.

Acceptance: Player slides on ice, momentum carries them across.`,
    area: "engineering/gameplay",
    subarea: "physics",
    credits: 100,
  },
  wind_zone: {
    title: "Add wind push zone mechanic",
    description: `Implement wind zones for pixel-platformer-1:

1. Create wind_zone.tscn:
   - Area2D with visual wind particles
   - Arrow particles indicating direction

2. Create wind_zone.gd:
   - Apply constant force to player while in zone
   - Configurable direction and strength
   - Optional: affects lightweight enemies too

3. Add to level_02 as environmental hazard.

Acceptance: Player is pushed by wind while in zone.`,
    area: "engineering/gameplay",
    subarea: "physics",
    credits: 100,
  },
  crush_hazard: {
    title: "Add crush/stomp hazard blocks",
    description: `Implement crush hazards for pixel-platformer-1:

1. Create crush_block.tscn:
   - StaticBody2D that becomes kinematic when triggered
   - Sprite with danger stripes
   - Warning particles before crush

2. Create crush_block.gd:
   - Trigger from player proximity or timer
   - Block falls quickly when triggered
   - Resets after delay

3. Place in level_02 as timing obstacles.

Acceptance: Block crushes player if standing underneath when triggered.`,
    area: "engineering/gameplay",
    subarea: "hazards",
    credits: 100,
  },
  projectile_enemy: {
    title: "Add ranged/projectile-shooting enemy",
    description: `Implement ranged enemy for pixel-platformer-1:

1. Create turret_enemy.tscn:
   - CharacterBody2D with animated turret sprite
   - Sprite rotates/facings

2. Create turret_enemy.gd:
   - Detect player within range
   - Fire projectile at intervals (every 2s)
   - Projectile: Area2D with velocity

3. Create projectile.tscn and projectile.gd:
   - Linear velocity toward player position at fire time
   - Damages player on contact
   - Disappears after timeout or wall hit

4. Add to level_02 at strategic positions.

Acceptance: Turret fires projectiles at player, projectiles damage player.`,
    area: "engineering/gameplay/enemies",
    subarea: "ai",
    credits: 150,
  },
  respawn_particles: {
    title: "Add respawn sparkle effect",
    description: `Implement respawn VFX for pixel-platformer-1:

1. Create respawn_effect.tscn:
   - CPUParticles2D with radial burst
   - Golden/sparkle particles
   - Fade out over 0.5s

2. Update player_controller.gd:
   - On respawn: instantiate effect at respawn position
   - Brief invulnerability flash

3. Coordinate with checkpoint activation.

Acceptance: Sparkle particles burst at respawn location.`,
    area: "engineering/gameplay/vfx",
    subarea: "particles",
    credits: 50,
  },
  player_trail: {
    title: "Add player motion trail/afterimage effect",
    description: `Implement motion trail for pixel-platformer-1:

1. Create trail_effect.tscn:
   - CPUParticles2D or Sprite2D trail
   - Short lifetime (0.2s)
   - Positioned at player

2. Update player_controller.gd:
   - Spawn trail particles at intervals
   - Faster movement = more particles
   - During dash state: stronger trail

3. Tune for performance (max 20 particles).

Acceptance: Player leaves a brief trail when moving fast.`,
    area: "engineering/gameplay/vfx",
    subarea: "particles",
    credits: 50,
  },
  collectible_gem: {
    title: "Add gem collectible with sparkle effect",
    description: `Implement gem collectible for pixel-platformer-1:

1. Create gem.tscn:
   - Sprite2D with gem texture (blue/purple crystal)
   - Area2D for collection
   - Animated: bobbing up/down + rotation

2. Create gem.gd:
   - On collect: play sound, particles, add to counter
   - Animate out (scale to 0)
   - Track collected gems in GameState

3. Place 5-10 gems in level_01 as optional collectibles.

Acceptance: Gems bob and sparkle, collected on touch with particles.`,
    area: "engineering/gameplay",
    subarea: "collectibles",
    credits: 100,
  },
  enemy_death_effect: {
    title: "Add enemy death explosion VFX",
    description: `Implement enemy death effects for pixel-platformer-1:

1. Create enemy_death_effect.tscn:
   - CPUParticles2D with explosion (red/orange particles)
   - Sprite flash
   - 0.3s duration

2. Update enemy scripts (patrol_enemy.gd, flying_enemy.gd):
   - On death: spawn effect at enemy position
   - Free enemy node after effect plays

3. Coordinate with EventBus.enemy_defeated.

Acceptance: Enemy plays explosion effect on death.`,
    area: "engineering/gameplay/vfx",
    subarea: "particles",
    credits: 50,
  },
  parallax_bg: {
    title: "Add parallax scrolling background layers",
    description: `Implement parallax background for pixel-platformer-1:

1. Create background layers in ParallaxBackground/ParallaxLayer:
   - Layer 1 (far): sky gradient, moves at 0.1x
   - Layer 2: distant mountains, moves at 0.3x
   - Layer 3: near decorations, moves at 0.6x

2. Add to main.tscn or level scenes:
   - Assign sprite/texture to each layer
   - Configure motion scale

3. Create or source pixel art background tiles.

Acceptance: Background scrolls at different speeds creating depth.`,
    area: "engineering/level-design",
    subarea: "visuals",
    credits: 100,
  },
  footstep_sfx: {
    title: "Add footstep sound effects",
    description: `Implement footstep sounds for pixel-platformer-1:

1. In player_controller.gd:
   - Track walk/run state
   - Play step sound at intervals (every 0.3s while moving)
   - Different pitch per surface type (stone, grass, metal)

2. In AudioManager or SfxManager:
   - Add footstep sound generation
   - Surface detection via tilemap or Area2D

3. Vary pitch randomly for natural feel.

Acceptance: Footstep sounds play while running, vary by surface.`,
    area: "engineering/audio",
    subarea: "sfx",
    credits: 50,
  },
  ambient_music_layer: {
    title: "Add ambient background music layer",
    description: `Implement ambient music for pixel-platformer-1:

1. Create ambient music in AudioManager:
   - Layer 2: subtle ambient pad (very quiet, -20dB)
   - Plays continuously beneath main music
   - Responds to environment (cave echo, outdoor wind)

2. Or create ambient.tscn:
   - AudioStreamPlayer with looping ambient
   - Crossfade between outdoor/cave ambient

3. Trigger via Area2D zones in levels.

Acceptance: Ambient layer adds atmosphere to different areas.`,
    area: "engineering/audio",
    subarea: "music",
    credits: 100,
  },
  game_over_screen: {
    title: "Add game over screen with retry option",
    description: `Implement game over screen for pixel-platformer-1:

1. Create game_over_screen.tscn:
   - Dark overlay
   - "Game Over" text
   - Lives remaining display
   - Retry button -> restart level
   - Main Menu button

2. Create game_over_screen.gd:
   - Show on 0 lives
   - Pause game tree
   - Handle retry/menu signals

3. Connect to GameState/GameManager on 0 lives.

Acceptance: Game over screen appears when lives reach 0, retry works.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
  },
  level_complete_stats: {
    title: "Add level complete screen with stats",
    description: `Implement level complete UI for pixel-platformer-1:

1. Create level_complete_screen.tscn:
   - "Level Complete!" header
   - Stats: time, gems, coins, deaths
   - Star rating (1-3 stars)
   - Next Level / Retry buttons

2. Create level_complete_screen.gd:
   - Display collected stats
   - Calculate star rating
   - Handle button signals

3. Connect to game_manager on level completion.

Acceptance: Level complete shows stats and rating after finishing level.`,
    area: "engineering/ui",
    subarea: "ui",
    credits: 100,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function grepProject(pattern: string, projectPath: string): boolean {
  const search = (dir: string): boolean => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          if (search(full)) return true;
        } else if (entry.isFile() && /\.(gd|tscn)$/.test(entry.name)) {
          try {
            const content = readFileSync(full, "utf8");
            if (content.toLowerCase().includes(pattern.toLowerCase())) return true;
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
    return false;
  };
  return search(projectPath);
}

function fileExists(path: string): boolean {
  try { return existsSync(path); } catch { return false; }
}

function filesExist(paths: string[]): boolean {
  return paths.length === 0 || paths.every((p) => fileExists(p));
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

function ticketExistsByAreaAndKeyword(board: TicketsBoard, area: string, keyword: string): boolean {
  const kwLower = keyword.toLowerCase();
  for (const col of board.columns) {
    for (const t of col.tickets) {
      const areaMatch = t.area?.toLowerCase() === area.toLowerCase();
      const titleMatch = t.title.toLowerCase().includes(kwLower);
      if (areaMatch && titleMatch) return true;
    }
  }
  return false;
}

// ─── Core Generator ───────────────────────────────────────────────────────────

/**
 * generateTickets — Scans project, generates missing tickets.
 * Returns an array of new ticket objects.
 * @param projectId  — dashboard project ID (e.g. "proj-1777998711330")
 * @param workspacePath — workspace-relative path (e.g. "pixel-platformer-1"). If not
 *                        provided, falls back to projectId so existing calls keep working.
 */
export async function generateTickets(projectId: string, workspacePath?: string): Promise<Ticket[]> {
  const effectivePath = workspacePath ?? projectId;
  const projectPath = join(WORKSPACE, effectivePath);
  if (!workspacePath || !existsSync(projectPath)) {
    return [];
  }

  // Re-read board fresh (passed-in board may be stale)
  const board = await readTicketsBoard(projectId);
  const newTickets: Ticket[] = [];
  const projectLabel = effectivePath;
  const pathNeedle = `${WORKSPACE}/pixel-platformer-1/`;

  for (const [key, template] of Object.entries(TICKET_TEMPLATES)) {
    const projectTemplate: TicketTemplate = {
      ...template,
      title: template.title.replaceAll("pixel-platformer-1", projectLabel),
      description: template.description.replaceAll("pixel-platformer-1", projectLabel),
    };

    // Skip if exact title already exists
    if (ticketExistsByTitle(board, projectTemplate.title)) {
      continue;
    }

    // Find relevant feature check
    const featureCheck = FEATURE_CHECKS.find(
      (f) => f.subarea === template.subarea || f.keywords.includes(key)
    );

    if (featureCheck) {
      const filesMustExist = featureCheck.filesMustExist.map((filePath) =>
        filePath.replace(pathNeedle, `${WORKSPACE}/${projectLabel}/`)
      );

      // Files must exist check
      if (filesMustExist.length > 0) {
        const allExist = filesExist(filesMustExist);
        if (allExist) {
          // Files exist — generate ticket (for fix/enhancement)
        } else {
          // Files don't exist — check grep for keyword in codebase
          const anyFound = featureCheck.keywords.some((kw) => grepProject(kw, projectPath));
          if (!anyFound) {
            // No files AND no grep match — skip this feature
            continue;
          }
        }
      } else {
        // filesMustExist is empty — feature has no files yet in codebase
        // Always offer the ticket (the feature is clearly missing)
      }
    }

    // Skip if area + keyword match already exists
    if (ticketExistsByAreaAndKeyword(board, template.area, key)) {
      continue;
    }

    const ticket: Ticket = {
      id: generateId("ticket"),
      projectId,
      title: projectTemplate.title,
      description: projectTemplate.description,
      area: projectTemplate.area,
      subarea: projectTemplate.subarea,
      credits: projectTemplate.credits,
      status: "available",
      acknowledged: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentRole: "godot-specialist",
    };

    newTickets.push(ticket);
  }

  // Sort by credits descending (valuable tickets first)
  newTickets.sort((a, b) => b.credits - a.credits);

  return newTickets;
}

/**
 * addTicketsToBoard — Adds generated tickets to the available column.
 */
export async function addTicketsToBoard(projectId: string, tickets: Ticket[]): Promise<void> {
  if (tickets.length === 0) return;

  const data = await readTicketsBoard(projectId);
  const availableCol = data.columns.find((c) => c.id === "available");
  if (!availableCol) throw new Error("No 'available' column found in project ticket board");

  for (const ticket of tickets) {
    availableCol.tickets.push(ticket);
  }

  await writeTicketsBoard(data, projectId);
}
