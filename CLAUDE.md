# MedProj (Seedling)

## Git workflow

Push work to a branch when a task is **finished** — not after every individual edit.

- Finished = the requested change is complete and verified (builds/tests pass, or the change was visually confirmed). Mid-task edits, partial refactors, and debugging states do not get pushed.
- Never commit directly to `main`. If the current branch is `main`, create a `feat/<slug>` or `fix/<slug>` branch first, matching the existing naming (`feat/levels-pose-pictures`, `fix/audit-major-findings`).
- On finish: stage the relevant files, commit with a conventional message (`feat:`, `fix:`, `chore:`), and `git push -u origin <branch>`.
- Do not open a PR or merge into `main` unless asked.
- Do not push generated or local-only artifacts: `.next/`, `node_modules/`, `graphify-out/`, `.env.local`.
