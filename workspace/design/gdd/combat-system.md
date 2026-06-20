---
name: Combat System
category: gameplay
status: draft
created: 2026-04-23
---

# Combat System Design Document

**Status:** DRAFT | **Version:** 2.0 (Auto-Battler) | **Author:** Game Designer
**Last Updated:** 2025-01-09

---

## Table of Contents

1. [Overview](#overview)
2. [Tick Resolution Engine](#tick-resolution-engine)
3. [Boxer AI Priority System](#boxer-ai-priority-system)
4. [Demon AI Behavior](#demon-ai-behavior)
5. [Formation & Positioning](#formation--positioning)
6. [Damage & Hit Resolution](#damage--hit-resolution)
7. [Hit Feedback & Game Feel](#hit-feedback--game-feel)
8. [Ability System](#ability-system)
9. [Status Effects](#status-effects)
10. [Balance Levers / Tuning Knobs](#balance-levers--tuning-knobs)
11. [Combat Pacing](#combat-pacing)
12. [Edge Cases](#edge-cases)
13. [Acceptance Criteria](#acceptance-criteria)

---

## Overview

This document defines an **auto-battler tick-based combat system** for "นักมวยต่อยปีศาจ / Boxer vs Demons", a 2D strategy game where players position Thai boxers on a grid and watch them fight waves of mythological demons.

**Core Philosophy:**
- **Pre-fight strategy, auto-execution**: All player decisions happen before combat (formation, loadout, training). Combat resolves automatically on a tick-based system with no twitch reflexes required.
- **Dramatic pacing**: Combat unfolds with deliberate, readable moments emphasized through hitstop, screen shake, and controlled slow-motion on impactful events.
- **Authentic Muay Thai**: Combat abilities and mechanics are rooted in real Thai boxing techniques.
- **Cultural authenticity**: Demons drawn from Thai/Asian mythology with unique, deterministic behaviors.

**Player Fantasy:**
> "I am the strategic mastermind behind an unstoppable fighting crew. I'm not throwing the punches myself — I'm training, positioning, and empowering warriors who unleash devastating Thai martial arts on nightmarish demons."

### MDA Framework Alignment

| Layer | Target Experience |
|-------|------------------|
| **Aesthetics** | **Challenge** (strategic depth), **Fantasy** (Muay Thai warrior master), **Discovery** (learning optimal compositions) |
| **Dynamics** | Emergent interactions between boxer archetypes, rock-paper-scissors with demon types, formation synergies, combo chains |
| **Mechanics** | Tick-based resolution, deterministic AI, stat-driven damage, cooldown management, formation positioning |

### Self-Determination Theory Alignment

| Need | How Combat Serves It |
|------|---------------------|
| **Autonomy** | Multiple viable formations, ability loadouts, boxer composition strategies |
| **Competence** | Clear cause-and-effect feedback; player sees WHY their strategy succeeded or failed |
| **Relatedness** | Connection to boxer characters, narrative bonds with Muay Thai culture |

---

## Tick Resolution Engine

### Tick Structure

Combat progresses in discrete 2-second ticks. Each tick follows a deterministic sequence:

```
FOR each tick:
    1. Reset tick state
    2. FOR each boxer:
       a. Threat assessment
       b. Range check
       c. Ability selection
       d. Movement (if needed)
       e. Queue action
    3. FOR each demon:
       a. Threat assessment
       b. Range check
       c. Ability selection
       d. Movement (if needed)
       e. Queue action
    4. Resolve all queued actions simultaneously
    5. Apply damage, status effects, KO checks
    6. Update cooldowns
    7. Trigger hit feedback (hitstop, screen shake, slow-mo)
    8. Check win/lose conditions
END FOR
```

### Detailed Tick Phases

#### Phase 1: Pre-Tick (simultaneous, no order dependency)
- Apply tick-based status effect durations (decrement counters)
- Process regen/life steal tick effects
- Update cooldown state (reduce active cooldowns by 1 tick)
- Resolve any ongoing damage-over-time (bleed, poison)

#### Phase 2: Intent Generation (parallel per unit)
- Each unit evaluates battlefield state and selects a target/action
- Boxers use archetype-specific priority system (Section 3)
- Demons use type-specific behavior (Section 4)
- Units with full CC (stun/root) generate WAIT intent

#### Phase 3: Intent Resolution (ordered by speed stat, highest to lowest)
- For units with same speed, random roll determines order (deterministic seed per match)
- Each unit executes its chosen action:
  - Check range to target; if out of range, move instead (if movement available)
  - Execute ability animation (frames play, but damage calculated now)
  - Apply ability effects (damage, CC, self-buffs)
- Units dying during this phase are marked as DEAD and removed before next tick

#### Phase 4: Hit Feedback Application (simultaneous after all resolutions)
- All damage numbers float simultaneously
- Hitstop applied to the aggressor (5-30 frames based on damage magnitude)
- Screen shake applied proportional to total damage dealt this tick
- KO slow-mo triggers if any unit reached 0 HP this tick

#### Phase 5: Post-Tick (simultaneous)
- Check win/loss conditions (all demons dead = win; all boxers dead = loss)
- Spawn next wave if conditions met
- Update UI displays (health bars, cooldown indicators)
- Prepare for next tick

### Timing Values

| Phase | Duration | Notes |
|-------|----------|-------|
| Full Tick | 2000ms | Base cadence (tunable) |
| Intent Generation | 0ms | Instant computation |
| Intent Resolution | 400-1600ms | Variable based on ability animations |
| Hit Feedback | 200-800ms | Hitstop + shake + slow-mo can extend |
| Post-Tick | 0ms | Instant state update |

### Determinism Guarantee

The combat engine uses a seeded random number generator per match. Given identical formations, loadouts, and training states, the same combat plays out identically. This enables players to learn and replay optimal strategies.

---

## Boxer AI Priority System

Each boxer archetype has unique AI priorities that reflect their fighting style.

### General Decision Framework

All boxers follow this base flow, with archetype-specific overrides:

1. **Survival Check**: If HP < 25%, prioritize defensive abilities or retreat
2. **CC Check**: If self is stunned/rooted, generate WAIT intent
3. **Target Selection**: Evaluate all valid targets using priority weights
4. **Range Check**: If target out of ability range, move toward nearest valid target
5. **Ability Selection**: Choose highest-priority available ability (off cooldown, enough stamina)
6. **Execute**: Resolve ability per its specification

### Muay Mat (Puncher/DPS)

**Role**: Aggressive damage dealer, prioritizes low-HP targets for kills

**Priority Weights**:
- Target HP < 30%: +3 (execute priority)
- Target is isolated: +2 (no nearby allies to retaliate)
- Target within punch range: +1
- Target has no active defense buff: +1

**Ability Selection Priority**:
1. **Cross Counter** (if available and enemy attacking self)
2. **Straight Punch** (primary DPS)
3. **Hook Combo** (if stamina > 60%)
4. **Power Overhand** (if target HP < 20%)
5. **Guard Up** (if HP < 40%)

**Targeting Bias**: Front-to-back (frontline first unless execute opportunity exists)

### Muay Femeu (Technician/Evasive)

**Role**: Counter-attacker, high dodge, punishes whiffed attacks

**Priority Weights**:
- Enemy recently missed attack: +4 (punish window)
- Enemy has low accuracy debuff: +2
- Target is melee (can be countered): +2
- Self dodge buff not active: +1

**Ability Selection Priority**:
1. **Teep Defense** (if enemy melee attacking self)
2. **Counter Elbow** (if enemy missed last tick)
3. **Round Kick** (primary damage)
4. **Side Step** (if surrounded by 2+ enemies)
5. **Focus Stance** (if no offensive opportunity)

**Targeting Bias**: Any position, prioritizes enemies who have recently attacked

### Muay Khao (Knee Fighter/CC)

**Role**: Frontline disruptor, crowd control through grapples and knees

**Priority Weights**:
- Target is ranged/backline: +3 (need to disrupt)
- Target has no active CC immunity: +2
- Target is high threat (boss/mage): +1
- Self in front row: +1 (leverage position)

**Ability Selection Priority**:
1. **Double Knee Grab** (primary CC)
2. **Clinch Knee** (if enemy is grappled)
3. **Low Sweep** (if enemy about to execute high-damage attack)
4. **Iron Shirt** (if taking focused fire)
5. **Push Kick** (create space)

**Targeting Bias**: Backline first (disrupt priority), then frontline

### Muay Sok (Elbow Specialist/Burst)

**Role**: High-burst damage dealer, devastating but telegraphed attacks

**Priority Weights**:
- Target HP < 50%: +3 (burst opportunity)
- Target is stationary (rooted/grappled): +3 (guaranteed hit)
- Self has buff active: +2
- Target has no active block/parry: +1

**Ability Selection Priority**:
1. **Sok Klab** (spinning back elbow, requires setup)
2. **Elbow Slash** (primary burst)
3. **Elbow Chop** (quick follow-up)
4. **Bloodthirsty Stance** (self-buff before burst)
5. **Feint** (setup for big combo)

**Targeting Bias**: Any position, prioritizes vulnerable (CC'd) targets

### Clinch Master (Support)

**Role**: Team enabler, buffs allies, disrupts enemy positioning

**Priority Weights**:
- Ally HP < 40%: +3 (heal/buff priority)
- Ally about to execute big attack: +2 (buff timing)
- Enemy high-value target: +1 (positioning opportunity)
- Self has resources: +1

**Ability Selection Priority**:
1. **Emergency Clinch** (if ally taking lethal damage)
2. **Team Rally** (if 2+ allies below 50% HP)
3. **Position Swap** (if ally in bad position)
4. **Buff Up** (if ally about to attack)
5. **Taunt** (if ally needs protection)

**Targeting Bias**: Allies first, then enemies for positioning

---

## Demon AI Behavior

Each demon type has distinct behavioral patterns and targeting priorities.

### Phi Pop (Possessing Spirit)
**Threat:** Low | **Behavior:** Ranged, attacks furthest boxer

**Priority Logic:**
1. Target furthest boxer (backline)
2. Attack from range 3 cells (cannot be counter-attacked by melee)
3. If boxer HP < 20%, use *Possess* (take control of fallen boxer for 3 ticks)
4. Retreat if boxer moves adjacent

**Special:** *Possess* — On KO attempt, can resurrect fallen boxer as temporary ally for 3 ticks

**Weakness:** High DEX (dodge) — Muay Femeu counters well

### Naga (Serpent)
**Threat:** Medium | **Behavior:** Linear frontline tank

**Priority Logic:**
1. Move forward in straight line (ignores diagonal)
2. Target closest boxer in front row
3. If 2+ enemies in line, use *Tail Sweep* (AoE 80% damage in line)
4. Never retreat

**Special:** *Scales* — -20% damage from piercing attacks, +20% from blunt

**Weakness:** Piercing attacks (knees/elbows) — Muay Khao, Muay Sok counter

### Preta (Hungry Ghost)
**Threat:** Medium | **Behavior:** Swarm

**Priority Logic:**
1. Always group with other Pretas (move toward cluster)
2. Target lowest HP boxer (opportunistic)
3. If HP < 30%, use *Explosion* (deal 100 damage to all adjacent units, die)
4. Never act alone (wait for at least 2 nearby Pretas)

**Special:** *Explosion* — On death (or when HP < 30% and triggered), deals AoE damage

**Weakness:** AoE damage — Muay Sok's *Spinning Elbow* counters swarms

### Yaksha (Giant Demon)
**Threat:** High | **Behavior:** Slow brute force

**Priority Logic:**
1. Target closest boxer regardless of position
2. Move 1 cell per 2 ticks (slow movement)
3. Every 3rd tick, use *Stomp* (AoE 120% damage, ignores back row)
4. If adjacent boxer, use *Smash* (200% damage, knockback 2 cells)

**Special:** *Ignore Back Row* — Stomp can hit back row boxers directly

**Weakness:** Knee attacks (knockback) — Muay Khao's *Flying Knee* counters

### Krasue (Flying Head)
**Threat:** High | **Behavior:** Backline assassin

**Priority Logic:**
1. Target highest DEX boxer (evade counter)
2. Fly over front row (can move through occupied cells)
3. On hit, apply *Life Drain* (heal self for damage_dealt * 30%)
4. If HP < 40%, flee to back of enemy formation

**Special:** *Fly* — Can move through occupied cells and over front row

**Weakness:** Elbow strikes (anti-air) — Muay Sok counters

### Mae Nak (Vengeful Spirit) — Boss
**Threat:** Boss | **Behavior:** 3-phase fight

**Phase 1 (100-60% HP):**
- Standard attacks, uses *Wail* (AoE fear, boxer retreat) every 4 ticks
- Targets random boxer each tick

**Phase 2 (60-30% HP):**
- *Ghostly Hands* pull random boxer to front
- *Haunt* applies curse (boxer takes damage on ability use)
- More aggressive targeting (focuses lowest HP boxer)

**Phase 3 (30-0% HP):**
- *Death Embrace* grabs nearest boxer, holds for 2 ticks
- *Soul Scream* deals massive AoE damage
- Enrages (increased damage, reduced defense)

**Weakness:** Critical hits — high-DEX boxers exploit vulnerability windows

---

## Formation & Positioning

The battlefield is a 3×4 grid divided into two zones:

```
[Enemy Zone]     [Boxer Zone]
[ ][ ][ ]        [ ][ ][ ]  ← Front Row
[ ][ ][ ]        [ ][ ][ ]
[ ][ ][ ]        [ ][ ][ ]
[ ][ ][ ]        [ ][ ][ ]  ← Back Row
```

### Position Rules

- **Front Row**: Melee boxers can attack immediately. Ranged demons draw aggro.
- **Back Row**: Melee boxers must move first. Ranged boxers safe from melee attacks.
- **Column Positioning**: Affects targeting order (center draws more aggro)
- **Formation**: 5 boxers occupy 6 slots (one slot empty for tactical flexibility)

### Position Bonuses

| Position | Bonus | Rationale |
|----------|-------|-----------|
| Front-Center | +10% damage dealt | Draw aggro, reward positioning |
| Front-Edges | +5% evasion | Harder to hit from angles |
| Back-Center | +15% ability damage | Safe positioning for focus fire |
| Back-Edges | +10% defense | Corner advantage |
| Flanked (adjacent enemies on 2+ sides) | -10% defense | Disadvantageous positioning |

### Movement Rules

- Boxers can move 1 tile per tick (if not using an ability)
- Movement is instantaneous (no travel time within tick)
- Cannot move through occupied tiles
- Can swap positions with ally using certain abilities (Clinch Master)

### Strategic Considerations

- **Frontline**: Muay Khao and Muay Mat benefit from front row (immediate melee range)
- **Backline**: Muay Sok benefits from back row (setup time for burst). Clinch Master works anywhere.
- **Empty Slot**: Leaving center-front empty can bait demons into clustering, enabling AoE
- **Column Distribution**: Spreading boxers reduces susceptibility to line attacks; concentrating enables focused support

---

## Damage & Hit Resolution

### Damage Formula

```
final_damage = (STR * ability.power) * (1 + crit_mult) * (1 + combo_mult) - defense
```

**Variable Definitions:**

| Variable | Source | Typical Range | Notes |
|----------|--------|---------------|-------|
| STR | Boxer base stat | 10-50 | Scales with training level |
| ability.power | Ability definition | 0.5-3.0 | Multiplier for base damage |
| crit_mult | Critical hit modifier | 0.0-2.0 | 0 = no crit, 1.5 = standard crit |
| combo_mult | Combo counter bonus | 0.0-1.0 | Increments on consecutive hits |
| defense | Target defense stat | 5-30 | Flat damage reduction |

### Minimum Damage Guarantee

- Final damage is always at least 1 (no zero-damage hits)
- Defense cannot reduce damage below 10% of pre-defense value

### Critical Hit System

**Crit Chance Calculation:**
```
crit_chance = base_crit_chance + (combo_counter * 0.02)
```
- Base crit chance varies by archetype (Muay Mat: 15%, Muay Sok: 20%, others: 10%)
- Combo counter increments on each consecutive hit on the same target
- Combo counter resets if target switches or if boxer takes damage

**Crit Damage Multiplier:**
- Standard crit: 1.5x damage
- Muay Sok abilities: 2.0x crit damage (elbow specialty)

### Combo System

**Combo Counter:**
- Starts at 0, maxes at 10
- Increments by 1 for each successful hit on same target
- Decrements by 1 each tick if no hit registered
- Resets to 0 if target changes or boxer takes damage

**Combo Multiplier:**
```
combo_mult = 0.1 * combo_counter
```
- Maximum combo_mult = 1.0 (10 consecutive hits)
- Visual feedback: combo counter displayed above boxer, flames intensify with higher combo

---

## Hit Feedback & Game Feel

The "badass factor" is critical to the auto-battler experience. Since players aren't executing attacks, every hit must feel satisfying through visual and audio feedback.

### Hit Types & Feedback

| Hit Type | Hitstop (frames) | Screen Shake | Visual Effect | Audio Cue | Slow-mo |
|----------|------------------|--------------|---------------|-----------|---------|
| **Normal** | 5 | None | Small white flash | Light impact | No |
| **Heavy** (>50% HP damage) | 10 | Light (2px, 0.1s) | Yellow flash | Heavy impact | No |
| **Critical** | 15 | Medium (4px, 0.2s) | Red flash + sparks | Critical hit sting | No |
| **KO** | 30 | Heavy (8px, 0.4s) | White flash + slow-mo | KO sound + crowd cheer | 0.5x for 0.5s |
| **Boss Phase Transition** | 45 | Extreme (12px, 0.6s) | Full-screen flash | Boss roar + music shift | 0.25x for 1.0s |
| **Combo 5+** | +2 per combo | Escalating | Fire trail on strikes | Combo counter voice | No |
| **Multi-Kill** (2+ KOs same tick) | 30 | Heavy + zoom | Rainbow flash | Multi-kill announcement | 0.3x for 0.8s |

### Hitstop Implementation

Hitstop freezes the aggressor sprite and target sprite for the specified frame count while the rest of the scene continues. This creates weight and impact without stalling the game:

- **Normal hitstop (5 frames)**: Barely perceptible, adds subtle weight
- **Critical hitstop (15 frames)**: Noticeable pause, player registers the impact
- **KO hitstop (30 frames)**: Dramatic freeze, camera zoom, slow recovery

### Screen Shake Curve

```
shake_intensity = damage / max_target_hp * max_shake_pixels
shake_duration = 0.1 + (damage / max_target_hp * 0.3)
```
- Light hits: 1-2px shake, 0.1s
- Medium hits: 3-4px shake, 0.2s
- Heavy hits: 6-8px shake, 0.4s
- KO: 10-12px shake, 0.6s

### Camera Behavior

- **Default**: Centered on formation, slight zoom to show full battlefield
- **KO Event**: Camera zooms to 1.5x on KO location, holds for 0.5s, then smooth return
- **Boss Phase**: Camera pulls back to show full arena, then snaps to boss
- **Multi-KO**: Camera rapidly pans between KO locations with micro-zooms

### Damage Number Display

- **Normal**: White numbers, float up and fade (0.5s)
- **Critical**: Red numbers, 1.5x size, float with slight screen-relative offset
- **Combo**: Numbers stack with previous, showing total combo damage
- **Healing**: Green numbers, float down
- **Status Effect Damage**: Purple numbers, smaller font

---

## Ability System

### Ability Structure

Each ability has the following properties:

| Property | Type | Description |
|----------|------|-------------|
| name | String | Display name |
| description | String | Tooltip text |
| power | Float | Damage multiplier (0.5-3.0) |
| range | Int | Cells reach (1-3) |
| cooldown | Int | Ticks between uses |
| stamina_cost | Int | Stamina consumed |
| hit_type | Enum | SINGLE, AOE_LINE, AOE_CIRCLE, SELF_BUFF |
| effects | Array | Status effects applied on hit |
| archetype | String | Which boxer type can use this |

### Ability Pools by Archetype

#### Muay Mat (Puncher)
| Ability | Power | Range | Cooldown | Special |
|---------|-------|-------|----------|---------|
| Straight Punch | 1.0 | 1 | 1 | None |
| Hook Combo | 1.5 | 1 | 3 | Hits twice |
| Cross Counter | 2.0 | 1 | 4 | Only triggers when attacked |
| Power Overhand | 3.0 | 1 | 6 | -25% accuracy, massive damage |

#### Muay Femeu (Technician)
| Ability | Power | Range | Cooldown | Special |
|---------|-------|-------|----------|---------|
| Round Kick | 1.2 | 2 | 1 | Reliable range |
| Counter Elbow | 1.5 | 1 | 3 | Only after dodge |
| Teep Defense | 0.8 | 1 | 2 | Push back 2 cells |
| Side Step | 0.0 | 0 | 3 | Dodge all attacks this tick |

#### Muay Khao (Knee Fighter)
| Ability | Power | Range | Cooldown | Special |
|---------|-------|-------|----------|---------|
| Clinch Knee | 1.0 | 1 | 1 | Root target 1 tick |
| Double Knee Grab | 1.5 | 1 | 3 | Root target 2 ticks |
| Low Sweep | 0.8 | 2 | 2 | Knockdown 1 tick |
| Flying Knee | 1.8 | 2 | 5 | Knockback 3 cells |

#### Muay Sok (Elbow Specialist)
| Ability | Power | Range | Cooldown | Special |
|---------|-------|-------|----------|---------|
| Elbow Slash | 1.4 | 1 | 1 | +20% crit chance |
| Elbow Chop | 1.8 | 1 | 3 | Bleed 3 ticks (10% HP/tick) |
| Sok Klab (Spinning Elbow) | 2.0 | 1 | 5 | AoE 2x2, no dodge |
| Bloodthirsty Stance | 0.0 | 0 | 4 | Self +30% damage for 3 ticks |

#### Clinch Master (Support)
| Ability | Power | Range | Cooldown | Special |
|---------|-------|-------|----------|---------|
| Taunt | 0.0 | 2 | 2 | Force enemy to target self |
| Buff Up | 0.0 | 2 | 3 | Ally +25% damage for 2 ticks |
| Emergency Clinch | 0.5 | 1 | 4 | Redirect 50% damage from ally to self |
| Position Swap | 0.0 | 2 | 5 | Swap positions with ally |

---

## Status Effects

| Effect | Duration | Effect | Counter |
|--------|----------|--------|---------|
| **Bleed** | 3 ticks | 10% max HP damage per tick | Healing effect |
| **Root** | 1-2 ticks | Cannot move | Cleanse ability |
| **Stun** | 1 tick | Cannot act | Cleanse ability |
| **Knockback** | Instant | Pushed 1-3 cells away | Position immunity (wall) |
| **Fear** | 1 tick | Forced retreat to back row | Courage buff |
| **Curse** | 3 ticks | Take damage on ability use | Dispel |
| **Defense Up** | 2-3 ticks | +25-50% defense | N/A (buff) |
| **Damage Up** | 2-3 ticks | +25-50% damage | N/A (buff) |
| **Dodge** | 1 tick | 100% evasion | AoE (cannot dodge) |
| **Life Steal** | 3 ticks | Heal 30% of damage dealt | Anti-heal debuff |

---

## Balance Levers / Tuning Knobs

These are the primary knobs for balancing combat difficulty and pacing.

### Tick & Pacing

| Knob | Default | Range | Category | Description |
|------|---------|-------|----------|-------------|
| tick_duration_ms | 2000 | 1000-3000 | Pacing | Milliseconds per tick |
| normal_speed | 1.0 | 0.5-2.0 | Pacing | Default playback speed |
| fast_forward_speed | 2.0 | 1.5-4.0 | Pacing | Fast-forward multiplier |
| slow_mo_speed | 0.5 | 0.2-0.75 | Feel | Slow-mo on KO/crit |
| slow_mo_duration | 0.5 | 0.3-1.5 | Feel | Slow-mo hold time (seconds) |

### Damage & Combat

| Knob | Default | Range | Category | Description |
|------|---------|-------|----------|-------------|
| crit_damage_multiplier | 1.5 | 1.25-3.0 | Balance | Base crit damage multiplier |
| combo_increment | 0.1 | 0.05-0.2 | Balance | Combo damage bonus per stack |
| combo_max_stacks | 10 | 5-20 | Balance | Maximum combo stacks |
| min_damage_pct | 0.1 | 0.05-0.2 | Safety | Minimum damage as % of raw |
| base_dodge_chance | 0.05 | 0.0-0.15 | Balance | Global base dodge chance |

### Difficulty Scaling

| Knob | Default | Range | Category | Description |
|------|---------|-------|----------|-------------|
| demon_hp_scale_per_stage | 1.2 | 1.1-1.5 | Scaling | HP multiplier per stage |
| demon_damage_scale_per_stage | 1.15 | 1.05-1.3 | Scaling | Damage multiplier per stage |
| wave_size_base | 3 | 2-5 | Scaling | Starting wave size |
| wave_size_max | 8 | 6-12 | Scaling | Maximum wave size |
| boss_hp_multiplier | 5.0 | 3.0-10.0 | Scaling | Boss HP vs normal demon |

### Feedback & Feel

| Knob | Default | Range | Category | Description |
|------|---------|-------|----------|-------------|
| hitstop_normal_frames | 5 | 2-10 | Feel | Hitstop frames for normal hits |
| hitstop_critical_frames | 15 | 8-25 | Feel | Hitstop frames for crits |
| hitstop_ko_frames | 30 | 15-45 | Feel | Hitstop frames for KOs |
| shake_max_pixels | 12 | 4-20 | Feel | Maximum screen shake in pixels |

---

## Combat Pacing

### Speed Controls

- **Normal (1x)**: Default, dramatic and readable
- **Fast Forward (2x)**: Available after first viewing of a wave type
- **Slow Motion (0.5x)**: Auto-triggers on KOs and critical moments
- **Pause**: Player can pause to inspect unit stats and battlefield state

### Wave Duration Targets

| Wave Type | Expected Ticks | Expected Duration (1x) | Notes |
|-----------|----------------|------------------------|-------|
| Easy (3 enemies) | 4-6 | 8-12 seconds | Tutorial waves |
| Medium (5 enemies) | 6-10 | 12-20 seconds | Standard gameplay |
| Hard (7 enemies) | 10-15 | 20-30 seconds | Challenge waves |
| Boss | 15-25 | 30-50 seconds | Stage-end encounters |

### Emotional Beat Structure

Each wave should follow a 3-beat structure:

1. **Opening (Ticks 1-3)**: Boxers engage, initial positioning matters, first contact
2. **Climax (Ticks 4-8)**: Peak action, abilities firing, KOs landing, combo chains building
3. **Resolution (Final ticks)**: Mop-up or desperate last stand, final KOs with slow-mo

---

## Edge Cases

| Scenario | Handling | Notes |
|----------|----------|-------|
| Both units die same tick | Both removed, check win/loss after removal | Simultaneous resolution |
| Boxer has no valid target | Idle stance, regenerate +10% stamina | Prevents wasted ticks |
| All abilities on cooldown | Use basic attack (power 0.8, no cooldown) | Always have a fallback |
| Demon and boxer swap into same cell | Priority to boxer (player advantage) | Prevents gridlock |
| Knockback into occupied cell | Reduce knockback distance until valid cell found | Prevents stacking |
| Stun + damage kills unit | Unit dies normally, stun wasted | No zombie state |
| Combo on dying enemy | Combo resets; switch target | Prevents infinite combo farming |
| Boss phase transition mid-tick | Complete current tick, then transition | Clean phase boundaries |
| All boxers stunned same tick | Skip boxer resolution, demons act freely | Punishing but recoverable |
| Formation overlap on start | Validate and reject invalid formations | Prevention over correction |

---

## Acceptance Criteria

### Functional Criteria
- [ ] Tick-based combat resolves deterministically (same inputs = same outputs)
- [ ] All 5 boxer archetypes have distinct AI behavior and ability pools
- [ ] All 6 demon types have unique behavior patterns and weaknesses
- [ ] Formation positioning affects combat outcomes (front/back/center/edge bonuses)
- [ ] Damage formula produces correct results for normal, critical, and combo hits
- [ ] Status effects apply and expire correctly based on tick counters
- [ ] Hit feedback (hitstop, shake, slow-mo) triggers at correct thresholds

### Experiential Criteria
- [ ] Combat feels dramatic and satisfying despite being auto-resolved
- [ ] KOs create memorable "moment" through slow-mo, shake, and audio
- [ ] Formation choices visibly affect combat outcomes
- [ ] Archetype synergies are discoverable and rewarding
- [ ] Wave pacing follows the 3-beat structure (opening, climax, resolution)

### Balance Criteria
- [ ] No single formation dominates all encounters
- [ ] All 5 archetypes are viable in at least 2 formation roles
- [ ] Demon difficulty scales smoothly across stages 1-10
- [ ] Boss fights require specific tactical adjustments (not brute force)
- [ ] Combo system rewards sustained focus-fire without being mandatory

---

## Dependencies

- [[character-stats]] — STR, DEX, VIT, WIS drive all combat calculations
- [[game-design]] — Core loop, progression, and economy integration
- [[adr-002-combat-engine]] — Technical implementation architecture
