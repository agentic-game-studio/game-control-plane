---
name: Character Stats
category: systems
status: draft
created: 2026-04-23
---

# Character Stats System (Auto-Battler)

Core stat framework for Muay Thai boxers in the tick-based auto-battler combat system. All stats feed into AI priority, damage resolution, cooldown management, and formation positioning.

## Overview

Each boxer has 4 base stats (STR, DEX, VIT, WIS) that derive all combat-relevant values. The system is designed for deterministic, tick-based combat with no real-time player input during battles. Stats determine how effectively each boxer performs their role in formation-based auto-combat against mythological demons.

## Player Fantasy

When viewing boxer stats, the player should feel:

> "I'm assembling a specialized fighting crew where each stat point matters. Every boxer has a clear role—frontline tank, damage dealer, or support—and their stats determine how well they execute that role. Understanding stat synergies is key to building an unstoppable squad."

The fantasy emphasizes **strategic mastery** over execution skill. The player's expertise comes from understanding stat interactions, archetype strengths, and formation composition rather than twitch reflexes.

### MDA Alignment
- **Aesthetics**: Challenge (build optimization), Discovery (stat synergies), Expression (rooster composition)
- **Dynamics**: Emergent team compositions, tactical counter-picking, power scaling through upgrades
- **Mechanics**: Deterministic damage formulas, AI priority weighting, cooldown management

## Base Stats

| Stat | Description | Primary Archetypes | Secondary Role |
|------|-------------|-------------------|----------------|
| **STR** | Physical damage power, combo damage | Muay Mat, Muay Khao | All damage dealers benefit |
| **DEX** | Critical hit rate, AI attack priority | Muay Femeu, Muay Sok | All benefit from crits |
| **VIT** | Max HP, defense, survivability | Muay Khao, Frontline | Critical for tanks |
| **WIS** | Support ability potency, healing | Clinch Master | Buff/debuff effectiveness |

**Stat Growth Types:**
- **Linear**: STR, VIT — consistent, predictable scaling
- **Diminishing**: DEX — early investment gives more value
- **Plateau**: WIS — strong early gains, plateau for support roles

## Derived Stats

All derived stats calculate from base stats using fixed formulas:

| Derived Stat | Formula | Purpose |
|--------------|---------|---------|
| **Max HP** | `base_hp + (VIT * hp_per_vit)` | Health pool before KO |
| **Physical Attack** | `base_atk + (STR * str_atk_multiplier)` | Base damage for damage formula |
| **Critical Hit Rate** | `base_crit_rate + (DEX * dex_crit_multiplier)` | Chance to trigger crit |
| **Critical Damage Multiplier** | `base_crit_dmg + (DEX * dex_crit_dmg_bonus)` | Bonus damage on crit |
| **Movement Speed** | `move_speed_cells_per_tick` | Grid cells per 2-second tick (fixed) |
| **Defense** | `base_defense + (VIT * vit_def_multiplier)` | Flat damage reduction |
| **Combo Multiplier Cap** | `base_combo_cap + (STR * str_combo_bonus)` | Max consecutive hit bonus |
| **AI Priority Weight** | `STR * 0.4 + DEX * 0.3 + VIT * 0.2 + WIS * 0.1` | Determines target selection |

## Stat Formulas

### Core Damage Formula

The combat system uses this damage calculation resolved on each tick:

```
final_damage = (attacker.STR * ability.power) * (1 + crit_mult) * (1 + combo_mult) - target.defense
```

Where:
- `ability.power` = Multiplier from the specific ability (e.g., Heavy Cross = 2.0, Teep = 0.8)
- `crit_mult` = `Critical Damage Multiplier / 100` if critical hit triggers, else 0
- `combo_mult` = `0.1 * consecutive_hits` (capped at `Combo Multiplier Cap`)
- `target.defense` = Flat damage reduction (minimum 0)

**Example Calculation:**
- Attacker: STR = 15, DEX = 10, combo_count = 3
- Target: Defense = 10
- Ability: Flying Knee (power = 1.2)
- Crit check: Passes (DEX gives 15% crit rate)
- Critical Damage Multiplier: 175%

```
final_damage = (15 * 1.2) * (1 + 0.75) * (1 + 0.3) - 10
final_damage = 18 * 1.75 * 1.3 - 10
final_damage = 40.95 - 10
final_damage = 31 (rounded)
```

### Critical Hit Calculation

Critical hits are determined at damage resolution time:

```
crit_chance = base_crit_rate + (DEX * dex_crit_multiplier)
is_critical = random(0, 100) < crit_chance
```

If `is_critical` is true, apply the Critical Damage Multiplier.

### Combo Multiplier

Combo multiplier builds from consecutive successful hits:

```
combo_mult = min(consecutive_hits * 0.1, Combo Multiplier Cap)
```

- Reset to 0 when: Character takes damage, ability misses, or 3 ticks pass without hitting
- Capped at `Combo Multiplier Cap` (see derived stats)

### Defense Formula

Defense is flat damage reduction, not percentage-based:

```
damage_after_defense = max(final_damage - target.defense, 0)
```

Minimum damage is always 1 (guaranteed chip damage).

## Archetype Base Stat Distributions

Each boxer archetype has distinct base stats at Level 1:

### Muay Mat (Puncher) — Aggressive DPS

| Stat | Level 1 | Growth per Level | Description |
|------|---------|------------------|-------------|
| STR | 15 | +2.5 | Highest damage output |
| DEX | 8 | +1.0 | Moderate crit chance |
| VIT | 8 | +1.0 | Glass cannon survivability |
| WIS | 5 | +0.5 | Minimal support |

**Role:** Frontline damage dealer. High STR maximizes damage from punch-heavy abilities (Heavy Cross, Jab Combo). Low VIT means requires tank protection or careful positioning.

### Muay Femeu (Technician) — Evasive Striker

| Stat | Level 1 | Growth per Level | Description |
|------|---------|------------------|-------------|
| STR | 10 | +1.5 | Moderate damage |
| DEX | 15 | +2.0 | Highest critical rate |
| VIT | 7 | +0.8 | Low survivability |
| WIS | 6 | +0.6 | Minimal support |

**Role:** Backline harasser. High DEX maximizes critical hit rate, making each hit impactful. Counter Kick ability auto-dodges, reducing need for high VIT. Best positioned in back row.

### Muay Khao (Knee Fighter) — Crowd Control Tank

| Stat | Level 1 | Growth per Level | Description |
|------|---------|------------------|-------------|
| STR | 12 | +1.5 | Moderate damage |
| DEX | 6 | +0.8 | Low crit rate |
| VIT | 18 | +2.5 | Highest HP and defense |
| WIS | 7 | +0.8 | Minor support |

**Role:** Frontline tank and disruptor. High VIT provides survivability to absorb damage. Flying Knee ability provides knockback, controlling enemy positioning. Best in front row.

### Muay Sok (Elbow Specialist) — Burst Area Damage

| Stat | Level 1 | Growth per Level | Description |
|------|---------|------------------|-------------|
| STR | 11 | +1.5 | Good burst damage |
| DEX | 12 | +1.5 | High crit on burst |
| VIT | 10 | +1.2 | Moderate survivability |
| WIS | 6 | +0.5 | Minimal support |

**Role:** Mid-range area denial. Spinning Elbow ability deals AoE damage, best against clustered enemies. Balanced stats allow flexible positioning. Mid-row optimal.

### Clinch Master (Support) — Team Buffer

| Stat | Level 1 | Growth per Level | Description |
|------|---------|------------------|-------------|
| STR | 6 | +0.8 | Low personal damage |
| DEX | 8 | +1.0 | Moderate crit rate |
| VIT | 12 | +1.5 | Good survivability |
| WIS | 20 | +2.5 | Highest support effectiveness |

**Role:** Strategic controller and team buffer. High WIS maximizes Clinch Hold duration and buff potency. Low STR means minimal personal damage contribution. Best positioned in middle row.

## Stat Growth Per Level

Each level increases stats based on archetype:

**Level 1 → 10 (Early Game):**
- Each archetype gains +0.5 of all stats automatically
- Per-level growth values (see archetype tables) applied on top

**Level 11 → 20 (Mid Game):**
- Base stat growth reduced to 75%
- Specialization bonuses unlocked (archetype-specific boosts)

**Level 21 → 30 (Late Game):**
- Base stat growth reduced to 50%
- Ultimate abilities unlocked at level 25

**Total Stat Scaling Example (Muay Mat at Level 30):**
- STR: 15 (base) + (29 × 2.5) + (15 × 0.5) = 15 + 72.5 + 7.5 = 95
- DEX: 8 (base) + (29 × 1.0) + (15 × 0.5) = 8 + 29 + 7.5 = 44.5
- VIT: 8 (base) + (29 × 1.0) + (15 × 0.5) = 8 + 29 + 7.5 = 44.5
- WIS: 5 (base) + (29 × 0.5) + (15 × 0.5) = 5 + 14.5 + 7.5 = 27

## Derived Stat Formulas

### Max HP

```
Max HP = base_hp + (VIT * hp_per_vit)
```

**Constants:**
- `base_hp` = 100 (tuning knob)
- `hp_per_vit` = 15 (tuning knob)

**Example (Muay Khao, VIT = 18):**
- Max HP = 100 + (18 × 15) = 100 + 270 = 370

### Physical Attack

```
Physical Attack = base_atk + (STR * str_atk_multiplier)
```

**Constants:**
- `base_atk` = 10 (tuning knob)
- `str_atk_multiplier` = 2.0 (tuning knob)

**Example (Muay Mat, STR = 15):**
- Physical Attack = 10 + (15 × 2.0) = 10 + 30 = 40

### Critical Hit Rate

```
Critical Hit Rate (%) = base_crit_rate + (DEX * dex_crit_multiplier)
```

**Constants:**
- `base_crit_rate` = 5.0% (tuning knob)
- `dex_crit_multiplier` = 1.0% (tuning knob)

**Example (Muay Femeu, DEX = 15):**
- Critical Hit Rate = 5% + (15 × 1%) = 20%

**Soft Cap:** After 50 DEX, `dex_crit_multiplier` halves to 0.5% per point.

### Critical Damage Multiplier

```
Critical Damage Multiplier (%) = base_crit_dmg + (DEX * dex_crit_dmg_bonus)
```

**Constants:**
- `base_crit_dmg` = 150% (tuning knob)
- `dex_crit_dmg_bonus` = 2.5% (tuning knob)

**Example (Muay Femeu, DEX = 15):**
- Critical Damage Multiplier = 150% + (15 × 2.5%) = 150% + 37.5% = 187.5%

### Movement Speed

```
Movement Speed = move_speed_cells_per_tick
```

**Constant:**
- `move_speed_cells_per_tick` = 1.0 (fixed for all characters)

Movement is constant across all boxers for balanced pacing. Strategic positioning comes from formation setup, not movement speed differences.

### Defense

```
Defense = base_defense + (VIT * vit_def_multiplier)
```

**Constants:**
- `base_defense` = 5 (tuning knob)
- `vit_def_multiplier` = 1.0 (tuning knob)

**Example (Muay Khao, VIT = 18):**
- Defense = 5 + (18 × 1.0) = 23

### Combo Multiplier Cap

```
Combo Multiplier Cap = base_combo_cap + (STR * str_combo_bonus)
```

**Constants:**
- `base_combo_cap` = 0.3 (tuning knob)
- `str_combo_bonus` = 0.01 (tuning knob)

**Example (Muay Mat, STR = 15):**
- Combo Multiplier Cap = 0.3 + (15 × 0.01) = 0.45 (45% max bonus)

**Meaning:** This boxer can build up to a 45% damage bonus from consecutive hits.

### AI Priority Weight

Each boxer uses a weighted priority to select targets:

```
AI Priority Weight = (STR * 0.4) + (DEX * 0.3) + (VIT * 0.2) + (WIS * 0.1)
```

Higher priority makes the boxer a more attractive target for enemy AI.

**Example (Muay Mat, STR = 15, DEX = 8, VIT = 8, WIS = 5):**
- AI Priority = (15 × 0.4) + (8 × 0.3) + (8 × 0.2) + (5 × 0.1) = 6 + 2.4 + 1.6 + 0.5 = 10.5

**Tactical Use:** Position high-priority targets in front row to absorb damage, or protect them with tanks.

## Stat Caps

### Hard Caps

| Stat | Hard Cap | Rationale |
|------|----------|-----------|
| STR | 100 | Prevents infinite damage scaling |
| DEX | 100 | Limits crit rate to reasonable cap |
| VIT | 100 | Prevents unkillable tanks |
| WIS | 100 | Limits support ability potency |

### Soft Caps

| Stat | Soft Cap | Effect After Cap |
|------|----------|------------------|
| DEX | 50 | Critical Hit Rate growth halves (1% → 0.5% per point) |
| STR | 80 | Combo Multiplier Cap growth reduces (0.01 → 0.005 per point) |
| VIT | 70 | Defense per point halves (1.0 → 0.5) |
| WIS | 60 | Support effect growth halves |

### Critical Hit Rate Cap

Maximum critical hit rate is **50%**, even with DEX soft cap reached. This ensures variance remains in combat.

## AI Priority Integration

Boxer stats feed directly into AI decision-making:

### Target Selection

Enemies select targets based on:

```
Target Score = (boxer.AI Priority Weight * threat_mult) - distance_penalty
```

Where:
- `threat_mult` = 1.0 for normal, 1.5 for low HP enemies
- `distance_penalty` = Manhattan distance × 0.5

### Ability Selection

Boxers select abilities based on:

1. **Cooldown Ready:** Filter to abilities not on cooldown
2. **Range Check:** Can target be reached from current position?
3. **Stat Matching:** Does ability scale with boxer's primary stat?
   - STR-heavy boxers prioritize STR-scaling abilities
   - DEX-heavy boxers prioritize abilities with crit synergy
4. **Combo Building:** Prefer abilities that can hit consecutive targets

**Example:** Muay Mat (STR = 15) prioritizes Heavy Cross (STR scaling, high damage) over Teep (low damage, knockback).

## Dependencies

- **Combat System (combat-system.md):** Uses stats for damage calculation, ability cooldowns, AI priority
- **Formation System:** AI Priority Weight determines optimal positioning
- **Progression System:** Level-ups grant stat growth
- **Demon AI (combat-system.md):** Targets boxers based on AI Priority Weight

## Edge Cases

| Scenario | Handling | Notes |
|----------|----------|-------|
| Zero Defense | Minimum damage always 1 | Guarantees chip damage |
| Negative stat values from debuffs | Treated as 0 | Stats cannot go below 0 |
| Defense higher than incoming damage | Minimum damage of 1 | Ensures combat progresses |
| Combo Mult exceeds cap | Capped at Combo Multiplier Cap | Hard limit enforced |
| Crit chance exceeds 50% | Capped at 50% maximum | Maintains variance |
| All boxers have same AI Priority | Random selection | Prevents deadlock |
| Tick-based overflow (multiple actions same tick) | Resolve in priority order: damage → movement → effects | Deterministic ordering |
| Level 0 (recruitment state) | Use Level 1 base stats | Prevents zero-stat characters |
| Boxer with 0 HP | KO state, removed from combat | Triggers KO animation |
| Stat overflow from temporary buffs | Hard cap enforced at 100 | Prevents exploitation |

## Tuning Knobs

| Knob Name | Default | Range | Category | Description |
|-----------|---------|-------|----------|-------------|
| base_hp | 100 | 50-200 | Curve | Base HP before VIT scaling |
| hp_per_vit | 15 | 10-25 | Curve | HP gained per VIT point |
| base_atk | 10 | 5-20 | Curve | Base attack before STR scaling |
| str_atk_multiplier | 2.0 | 1.0-5.0 | Curve | Damage per STR point |
| base_crit_rate | 5.0 | 1.0-10.0 | Curve | Base critical hit chance % |
| dex_crit_multiplier | 1.0 | 0.5-2.0 | Curve | Crit rate % per DEX point |
| base_crit_dmg | 150 | 125-200 | Curve | Base critical damage multiplier % |
| dex_crit_dmg_bonus | 2.5 | 1.0-5.0 | Curve | Crit damage % per DEX point |
| move_speed_cells_per_tick | 1.0 | 0.5-2.0 | Feel | Cells moved per 2-second tick |
| base_defense | 5 | 0-15 | Curve | Base defense before VIT scaling |
| vit_def_multiplier | 1.0 | 0.5-2.0 | Curve | Defense per VIT point |
| base_combo_cap | 0.3 | 0.2-0.5 | Curve | Base combo multiplier cap |
| str_combo_bonus | 0.01 | 0.005-0.02 | Curve | Combo cap bonus per STR point |
| crit_rate_hard_cap | 50 | 40-75 | Gate | Maximum critical hit rate % |
| stat_hard_cap | 100 | 80-150 | Gate | Maximum value for any base stat |
| ai_str_weight | 0.4 | 0.2-0.6 | Feel | STR weight in AI priority |
| ai_dex_weight | 0.3 | 0.1-0.5 | Feel | DEX weight in AI priority |
| ai_vit_weight | 0.2 | 0.1-0.4 | Feel | VIT weight in AI priority |
| ai_wis_weight | 0.1 | 0.0-0.3 | Feel | WIS weight in AI priority |

## Acceptance Criteria

### Functional Criteria
- [ ] All derived stats calculate correctly from base stats using provided formulas
- [ ] Damage formula properly incorporates STR, ability power, crit multiplier, and combo multiplier
- [ ] Defense reduces damage but never prevents all damage (minimum 1)
- [ ] Critical hit rate and damage multiplier calculate correctly with DEX scaling
- [ ] Combo multiplier builds correctly from consecutive hits and caps appropriately
- [ ] AI Priority Weight calculates correctly and influences enemy targeting
- [ ] All stat caps (hard and soft) are enforced correctly
- [ ] Edge cases (negative values, overflow, zero stats) are handled gracefully

### Experiential Criteria
- [ ] Archetype stat differences feel meaningful: Muay Mat deals noticeably more damage than Clinch Master
- [ ] Progression feels impactful: Level 10 boxers are clearly stronger than Level 1
- [ ] Critical hits provide satisfying feedback with visible damage spike (150-200% multiplier)
- [ ] Combos feel rewarding: Consecutive hits build up noticeable damage bonus
- [ ] Tanks feel durable: Muay Khao survives significantly longer than Muay Mat
- [ ] Support effects feel impactful: Clinch Master's buffs noticeably improve team performance
- [ ] AI targeting feels intelligent: High-priority damage dealers draw more attacks
- [ ] Build diversity is viable: Multiple archetype compositions can succeed

### Balance Criteria
- [ ] No single stat dominates: Each archetype has clear strengths and weaknesses
- [ ] Damage vs Survivability trade-off: High STR archetypes (Muay Mat) have lower VIT
- [ ] Critical rate is impactful but not overpowered: 50% cap prevents crit-only builds
- [ ] Combo system rewards consistent damage without being mandatory: Non-combo builds remain viable
- [ ] AI priority creates meaningful positioning decisions: Protecting high-STR boxers matters
- [ ] Stat growth scales appropriately across levels: Level 30 boxers are ~5-6x stronger than Level 1, not 100x
- [ ] Archetype balance: All 5 archetypes have viable roles in different compositions
- [ ] Defense scaling is noticeable but doesn't create unkillable tanks: VIT soft cap prevents infinite scaling

### Integration Criteria
- [ ] Stats integrate correctly with damage formula in combat-system.md
- [ ] AI Priority Weight connects to demon targeting logic
- [ ] Derived stats feed into ability selection and cooldown management
- [ ] Stat caps prevent exploits while allowing meaningful progression
- [ ] Formation positioning rewards correct stat-based target priority
