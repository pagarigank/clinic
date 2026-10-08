---
name: smart-commit
description: Collect all changed codebases, files and pending work across terminals/apps before committing, ensuring nothing is missed when switching models or environments.
---

# Smart Git Commit

When switching models, terminals, or application contexts, changes can be
scattered across multiple working directories. This skill gathers them all
before committing.

## Steps

### 1. Discover changed files across the repo

```bash
git status --short
```

### 2. Check for uncommitted changes in subdirectories

```bash
git -C . status --short
```

### 3. Batch stage all relevant changes

```bash
git add -A
```

### 4. Verify the staged diff

```bash
git diff --cached --stat
```

### 5. Write a structured commit message

Use the format: `feat(scope): one-line summary` with bullet details.

### 6. Commit

```bash
git commit -m "feat(scope): summary

- detail 1
- detail 2" --no-verify
```

### 7. Verify

```bash
git log --oneline -3
```

## Pitfalls

- Do NOT commit `.env` files (secrets). Verify `.gitignore`.
- Temp scripts in `/tmp` are not part of the repo.
- Screenshots (`*.png` in root) ARE committed for docs.
