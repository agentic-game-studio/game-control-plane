---
name: Combat System
category: gameplay
status: draft
created: 2026-04-23
---

# Combat System Overview

> SYS.LOG ENTRY: COMBAT-SPEC-001

The combat system uses a real-time action framework with modular damage types.

## Player Fantasy

Players feel like tactical commanders combining elemental attacks in fast-paced encounters.

## Detailed Rules

1. Each character has 3 active skill slots
2. Skills chain based on elemental affinity
3. Combo multiplier increases with consecutive hits

### Damage Calculation

Base damage is modified by:

```
final_damage = base_power * (1 + combo_multiplier) * elemental_modifier - target_defense
```

## Formulas

- `combo_multiplier = 0.1 * consecutive_hits`
- `elemental_modifier` ranges from 0.5 (resisted) to 2.0 (weakness)

## Edge Cases

| Scenario | Handling | Severity |
|----------|----------|----------|
| Player dies mid-combo | Combo resets, no death penalty for 3s | high |
| Two elements conflict | Use last applied element | medium |
| Overkill damage | Excess damage splashes to nearby enemies | low |

## Dependencies

- [[character-stats]] — base stats feed into damage formula
- [[elemental-system]] — defines elemental affinities

## Tuning Knobs

| Knob | Default | Range | Description |
|------|---------|-------|-------------|
| combo_decay_time | 2.0s | 0.5-5.0 | Time before combo resets |
| max_combo_multiplier | 3.0x | 1.0-10.0 | Damage cap for combos |
| splash_range | 2.0 | 0.5-5.0 | Overkill splash radius |

## Acceptance Criteria

- Combat feels responsive under 60fps
- Combo system is visually clear to players
- Damage numbers display within 100ms of hit
