# Graph Report - MedProj  (2026-07-07)

## Corpus Check
- 62 files · ~133,270 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 442 nodes · 581 edges · 36 communities (22 shown, 14 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `472793e4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_poseDetection.ts|poseDetection.ts]]
- [[_COMMUNITY_page.tsx|page.tsx]]
- [[_COMMUNITY_🎉 Complete! User Authentication & Progress Tracking System|🎉 Complete! User Authentication & Progress Tracking System]]
- [[_COMMUNITY_createClient|createClient]]
- [[_COMMUNITY_dependencies|dependencies]]
- [[_COMMUNITY_What You Must Do When Invoked|What You Must Do When Invoked]]
- [[_COMMUNITY_Phase 5 Dynamic Session Player — Summary|Phase 5: Dynamic Session Player — Summary]]
- [[_COMMUNITY_Therapy App - User Authentication & Progress Tracking Setup|Therapy App - User Authentication & Progress Tracking Setup]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_Design|Design]]
- [[_COMMUNITY_Design Critique MedProj Physical Therapy App|Design Critique: MedProj Physical Therapy App]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_page.tsx|page.tsx]]
- [[_COMMUNITY_graphify reference extra exports and benchmark|graphify reference: extra exports and benchmark]]
- [[_COMMUNITY_Product|Product]]
- [[_COMMUNITY_graphify reference query, path, explain|graphify reference: query, path, explain]]
- [[_COMMUNITY_layout.tsx|layout.tsx]]
- [[_COMMUNITY_CycleRepCounter|CycleRepCounter]]
- [[_COMMUNITY_graphify reference add a URL and watch a folder|graphify reference: add a URL and watch a folder]]
- [[_COMMUNITY_graphify reference commit hook and native CLAUDE.md integration|graphify reference: commit hook and native CLAUDE.md integration]]
- [[_COMMUNITY_graphify reference incremental update and cluster-only|graphify reference: incremental update and cluster-only]]
- [[_COMMUNITY_RepCounter|RepCounter]]
- [[_COMMUNITY_route.ts|route.ts]]
- [[_COMMUNITY_graphify reference GitHub clone and cross-repo merge|graphify reference: GitHub clone and cross-repo merge]]
- [[_COMMUNITY_graphify reference transcribe video and audio|graphify reference: transcribe video and audio]]
- [[_COMMUNITY_CLAUDE|CLAUDE.md]]
- [[_COMMUNITY_CLAUDE|CLAUDE.md]]
- [[_COMMUNITY_extraction-spec|extraction-spec.md]]
- [[_COMMUNITY_.eslintrc.json|.eslintrc.json]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_next.config.js|next.config.js]]
- [[_COMMUNITY_next-env.d.ts|next-env.d.ts]]
- [[_COMMUNITY_postcss.config.mjs|postcss.config.mjs]]
- [[_COMMUNITY_tailwind.config.ts|tailwind.config.ts]]

## God Nodes (most connected - your core abstractions)
1. `createClient()` - 23 edges
2. `compilerOptions` - 16 edges
3. `DashboardPage()` - 12 edges
4. `EditExercisePage()` - 12 edges
5. `What You Must Do When Invoked` - 12 edges
6. `🎉 Complete! User Authentication & Progress Tracking System` - 12 edges
7. `/graphify` - 11 edges
8. `Phase 5: Dynamic Session Player — Summary` - 11 edges
9. `initDetector()` - 10 edges
10. `getProgress()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `DashboardPage()` --calls--> `createClient()`  [EXTRACTED]
  app/(dashboard)/page.tsx → lib/supabase/client.ts
- `RecordedFrame` --references--> `Pose`  [EXTRACTED]
  app/admin/exercises/[id]/edit/page.tsx → lib/poseDetection.ts
- `Exercise` --references--> `TrackingMode`  [EXTRACTED]
  app/admin/exercises/[id]/edit/page.tsx → lib/poseDetection.ts
- `EditExercisePage()` --calls--> `createClient()`  [EXTRACTED]
  app/admin/exercises/[id]/edit/page.tsx → lib/supabase/client.ts
- `RecordedFrame` --references--> `Pose`  [EXTRACTED]
  app/admin/exercises/new/page.tsx → lib/poseDetection.ts

## Import Cycles
- None detected.

## Communities (36 total, 14 thin omitted)

### Community 0 - "poseDetection.ts"
Cohesion: 0.05
Nodes (65): AngleCriterion, EditExercisePage(), Exercise, formatJointName(), LevelingRule, RecordedDemo, RecordedFrame, NewExercisePage() (+57 more)

### Community 1 - "page.tsx"
Cohesion: 0.12
Nodes (26): AdminUserPage(), Profile, getGreeting(), getNextStageName(), getStageName(), getStageProgressPercent(), getStarsNeededForNextStage(), DashboardPage() (+18 more)

### Community 2 - "🎉 Complete! User Authentication & Progress Tracking System"
Cohesion: 0.06
Nodes (30): 1. Create an Account, 1. **User Authentication**, 2. **Session Tracking**, 2. View Empty Dashboard, 3. Complete a Session, 3. **Progress Dashboard** (`/dashboard`), 4. **Database Schema**, 4. See Your Progress (+22 more)

### Community 3 - "createClient"
Cohesion: 0.09
Nodes (17): DIFFICULTY_STYLES, ExerciseRow, fieldLabelStyle, Group, inputStyle, DIFFICULTY_STYLES, Exercise, Profile (+9 more)

### Community 4 - "dependencies"
Cohesion: 0.07
Nodes (29): dependencies, autoprefixer, canvas-confetti, date-fns, eslint, eslint-config-next, framer-motion, @mediapipe/hands (+21 more)

### Community 5 - "What You Must Do When Invoked"
Cohesion: 0.07
Nodes (26): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+18 more)

### Community 6 - "Phase 5: Dynamic Session Player — Summary"
Cohesion: 0.08
Nodes (24): 1. Exercise Load, 1. Generic Pose Validation Engine (`lib/poseDetection.ts`), 2. Camera Setup, 2. Updated Session Page (`app/session/page.tsx`), 3. Real-Time Validation Loop, 4. Rep Completion, 5. Session Completion, Admin Setup Checklist (+16 more)

### Community 7 - "Therapy App - User Authentication & Progress Tracking Setup"
Cohesion: 0.10
Nodes (20): 1. Create a Supabase Account, 2. Set Up the Database, 3. Get Your Supabase Credentials, 4. Configure Environment Variables, 5. Install Dependencies & Run, 🚀 Next Steps, Per Rep:, Per Session: (+12 more)

### Community 8 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 9 - "Design"
Cohesion: 0.11
Nodes (17): Border Radius, Color, Dark session mode (camera + exercise screen), Day strip, Design, Key Components, Light mode (app shell), Motion (+9 more)

### Community 10 - "Design Critique: MedProj Physical Therapy App"
Cohesion: 0.12
Nodes (16): Anti-Patterns Verdict, Design Critique: MedProj Physical Therapy App, Design Health Score, Minor Observations, Overall Impression, **[P0] No first-run onboarding**, **[P0] Session has no pause or cancel-with-save**, **[P1] Progress calendar mostly empty** (+8 more)

### Community 11 - "package.json"
Cohesion: 0.12
Nodes (15): author, description, devDependencies, @types/canvas-confetti, @types/three, keywords, license, main (+7 more)

### Community 12 - "page.tsx"
Cohesion: 0.26
Nodes (9): DIFFICULTY_STYLES, buildLevelMap(), CompletedSession, ExerciseNode, GroupNode, LevelExercise, LevelGroup, NodeStatus (+1 more)

### Community 13 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 14 - "Product"
Cohesion: 0.22
Nodes (8): Accessibility & Inclusion, Anti-references, Brand Personality, Design Principles, Product, Product Purpose, Register, Users

### Community 15 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 16 - "layout.tsx"
Cohesion: 0.40
Nodes (3): dmSerif, inter, metadata

### Community 18 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 19 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 20 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

## Knowledge Gaps
- **248 isolated node(s):** `extends`, `WeekSession`, `RecordedDemo`, `AngleCriterion`, `LevelingRule` (+243 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createClient()` connect `createClient` to `poseDetection.ts`, `page.tsx`, `page.tsx`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `extends`, `WeekSession`, `RecordedDemo` to the rest of the system?**
  _250 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `poseDetection.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05328005328005328 - nodes in this community are weakly interconnected._
- **Should `page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.12222222222222222 - nodes in this community are weakly interconnected._
- **Should `🎉 Complete! User Authentication & Progress Tracking System` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Should `createClient` be split into smaller, more focused modules?**
  _Cohesion score 0.0896551724137931 - nodes in this community are weakly interconnected._