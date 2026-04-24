# Agent Instructions

## Critical Rule: No Auto Commit/Push

**Never commit or push to git without explicit user instruction.**

After completing work:
1. Ask the user before committing: "ต้องการ commit/push ไหมครับ"
2. Wait for explicit approval
3. Only then execute `git commit` and/or `git push`

Exception: Only if the user explicitly says "commit and push" in the same turn.

This rule exists because the user wants full control over when changes are committed and pushed to the repository.
