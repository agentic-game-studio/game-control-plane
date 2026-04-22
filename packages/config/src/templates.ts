/** Default GDD section structure (from coding-standards.md — 8 required sections) */
export const GDD_TEMPLATE = `---
name: {systemName}
category: {category}
status: draft
created: {date}
---

# {systemName}

## 1. Overview

_One-paragraph summary of this system._

## 2. Player Fantasy

_What feeling and experience does this system deliver to the player?_

## 3. Detailed Rules

_Unambiguous mechanics and behavior specifications._

## 4. Formulas

\`\`\`
# Define all math with variables
{formula_name} = {expression}
# Variables:
#   {var} — {description}
\`\`\`

## 5. Edge Cases

| Scenario | Handling | Severity |
|----------|----------|----------|
| | | |

## 6. Dependencies

- _Other systems this system depends on_
- _Systems that depend on this system_

## 7. Tuning Knobs

| Knob | Default | Range | Description |
|------|---------|-------|-------------|
| | | | |

## 8. Acceptance Criteria

| ID | Criterion | Type | Testable |
|----|-----------|------|----------|
| | | | |`;

/** Default ADR structure */
export const ADR_TEMPLATE = `---
id: ADR-{number}
title: {title}
status: proposed
created: {date}
---

# {title}

## Status

Proposed

## Context

_What is the issue that we're seeing that is motivating this decision or change?_

## Decision

_What is the change that we're proposing and/or doing?_

## Alternatives

### Option A

**Pros:**
-

**Cons:**


### Option B

**Pros:**
-

**Cons:**


## Consequences

_What becomes easier or more difficult to do because of this change?_

## Related GDDs

-

## Engine Version

_Engine version being used for this project_`;
