---
name: Character Stats
category: systems
status: draft
created: 2026-04-23
---

# Character Stats System

Core stat framework that feeds into all gameplay systems.

## Overview

Each character has 6 base stats that derive all combat and exploration values.

## Base Stats

| Stat | Description | Growth |
|------|-------------|--------|
| STR | Physical power | Linear |
| DEX | Agility, crit rate | Diminishing |
| INT | Magic power, MP | Linear |
| VIT | Health, defense | Linear |
| WIS | Magic defense, MP regen | Diminishing |
| LCK | Crit damage, item drops | Random |

## Dependencies

- [[combat-system]] — uses STR, DEX for physical; INT, WIS for magic
- [[leveling-system]] — stat growth per level
