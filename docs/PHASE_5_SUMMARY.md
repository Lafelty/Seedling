# Phase 5: Dynamic Session Player — Summary

**Status:** ✅ Complete  
**Date:** July 4, 2026

## Overview

Phase 5 replaces the hardcoded "Shoulder Raise" validation with a **generic exercise validation engine** that reads exercises from the database and validates poses against the recorded `pose_criteria`. This is the final phase that ties the entire admin pose system together.

---

## What Was Built

### 1. Generic Pose Validation Engine (`lib/poseDetection.ts`)

Added new exports:

- **`analyzeExercise()`** — Generic validation function that:
  - Checks if target body parts are visible (confidence threshold)
  - Validates angle criteria (min/max/target angles between three keypoints)
  - Validates leveling rules (symmetry constraints between joints)
  - Returns `ExerciseAnalysis` with `meetsAllCriteria`, `feedback`, `message`, `failedCriteria`

- **`GenericRepCounter`** — Generic rep counter class that:
  - Works with any exercise type (static holds or dynamic movements)
  - Accepts configurable `holdThresholdMs` from database
  - Counts reps when user enters/exits correct position and holds for threshold duration
  - Returns `repCount`, `justCompleted`, `holdProgress`, `holdMissed`

- **Helper functions**:
  - `calculateAngle()` — Calculates angle between three keypoints (A-B-C returns angle at B)
  - `getKeypoint()` — Retrieves keypoint by name with confidence check

### 2. Updated Session Page (`app/session/page.tsx`)

**Changes:**

- **Loads exercises from database** — Fetches the first active exercise on component mount
- **Uses `GenericRepCounter`** initialized with exercise-specific `hold_duration_ms`
- **Uses `analyzeExercise()`** instead of hardcoded `analyzeShoulderRaise()`
- **Exercise-specific feedback** — Reads `feedback_messages` from database
- **Exercise-specific instructions** — Shows `exercise.description` instead of hardcoded text
- **Dynamic hold duration** — Displays `hold_duration_ms` from database in countdown screen
- **Loading state** — Shows spinner while exercise is being fetched
- **Saves `exercise_id`** to `therapy_sessions` table instead of hardcoded `exercise_type`

---

## Database Integration

### Exercises Table Structure

```sql
{
  id: UUID,
  name: "Shoulder Raise",
  description: "Raise both arms above shoulder height and hold",
  exercise_type: "static" | "dynamic",
  pose_criteria: {
    targetBodyParts: ["leftShoulder", "rightShoulder", ...],
    criteria: [
      {
        joint: "leftShoulder",
        minAngle: 80,
        maxAngle: 100,
        targetAngle: 90,
        relativeTo: ["leftElbow", "leftHip"]
      }
    ],
    levelingRules: [
      {
        joints: ["leftShoulder", "rightShoulder"],
        maxDifference: 10,
        message: "Keep shoulders level"
      }
    ]
  },
  target_reps: 10,
  hold_duration_ms: 500,
  feedback_messages: {
    perfect: "Perfect form!",
    tooLow: "Raise higher",
    tooHigh: "Lower slightly",
    notLevel: "Keep level",
    analyzing: "Reading your movement...",
    notInFrame: "Position yourself in frame"
  }
}
```

---

## How It Works (End-to-End Flow)

### 1. Exercise Load
- Session page fetches the first active exercise from `exercises` table
- Initializes `GenericRepCounter` with `exercise.hold_duration_ms`
- Displays loading spinner until exercise is ready

### 2. Camera Setup
- Waits for exercise to load before starting camera
- Initializes MoveNet pose detector
- Starts countdown (3, 2, 1...)
- Speaks exercise description when countdown ends

### 3. Real-Time Validation Loop
```typescript
// Detect pose keypoints
const pose = await detectPose(video)

// Validate against exercise criteria
const analysis = analyzeExercise(pose, exercise.pose_criteria, exercise.feedback_messages)

// Count reps
const { repCount, justCompleted, holdProgress, holdMissed } = repCounter.count(analysis)

// Show feedback
setPostureFeedback(analysis.feedback) // 'good' | 'adjust' | 'analyzing'
setFeedbackMessage(analysis.message)  // Exercise-specific message from DB
```

### 4. Rep Completion
- User enters correct position (all criteria met)
- Holds for `hold_duration_ms` (progress bar fills)
- Exits position → rep counted
- Speaks: "Rep {N} completed! {X} more to go."

### 5. Session Completion
- Reaches `target_reps` → saves session data
- Records: `duration_seconds`, `completed_reps`, `form_quality_score`
- Saves per-rep data: `rep_number`, `hold_duration_ms`, `form_score`, `timestamp`
- Shows completion screen with confetti

---

## Validation Logic

### Angle Criteria Validation

For each criterion in `pose_criteria.criteria`:

1. Get three keypoints: `joint`, `relativeTo[0]`, `relativeTo[1]`
2. Calculate angle at `joint` formed by the three points
3. Check if angle is within `[minAngle, maxAngle]`
4. If too low → `failedCriteria.push('{joint}_tooLow')`
5. If too high → `failedCriteria.push('{joint}_tooHigh')`

### Leveling Rules Validation

For each rule in `pose_criteria.levelingRules`:

1. Get two keypoints: `joints[0]`, `joints[1]`
2. Calculate vertical difference: `Math.abs(joint1.y - joint2.y)`
3. If difference > `maxDifference` → failed

### Feedback Generation

```typescript
if (meetsAllCriteria) {
  feedback = 'good'
  message = feedback_messages.perfect
} else {
  feedback = 'adjust'
  // Specific message based on first failed criterion
  if (firstFail.includes('tooLow')) {
    message = feedback_messages.tooLow
  } else if (firstFail.includes('tooHigh')) {
    message = feedback_messages.tooHigh
  } else if (firstFail.includes('leveling')) {
    message = feedback_messages.notLevel
  }
}
```

---

## Backward Compatibility

**Old functions still exported** (for admin recording/editing pages):
- `analyzeShoulderRaise()`
- `RepCounter`
- `shouldersInFrame()`

These remain unchanged for Phases 3 & 4 (admin system).

---

## Build Verification

✅ **Build successful** — All routes compile:

```
Route (app)
├ ○ /session              (uses generic validation)
├ ○ /admin/exercises/new  (uses old RepCounter for recording)
├ ƒ /admin/exercises/[id]/edit (uses old functions for playback)
```

---

## Next Steps (Beyond Phase 5)

### Admin Setup Checklist
1. Sign up at `/signup` with `adminNeena@gmail.com` / `654321`
2. Run `supabase/scripts/set-admin.sql` in Supabase SQL Editor to set `is_admin = TRUE`
3. Test recording interface at `/admin/exercises/new`
4. Record 2-3 demos, save as draft exercise
5. Test refinement editor at `/admin/exercises/{id}/edit`
6. Add angle criteria and leveling rules, publish exercise
7. Test session at `/session` to validate the published exercise works

### Potential Enhancements
- **Multi-exercise sessions** — Allow users to select from a list of active exercises
- **Progress tracking** — Show per-exercise completion history
- **Difficulty progression** — Auto-suggest harder exercises based on form quality
- **Dynamic movements** — Support continuous motion validation (e.g., bicep curls, squats)
- **Real-time angle display** — Overlay current angles on the skeleton for debugging

---

## Files Changed

| File | Changes |
|------|---------|
| `lib/poseDetection.ts` | +237 lines — Added `analyzeExercise()`, `GenericRepCounter`, angle calculation |
| `app/session/page.tsx` | Modified — Replaced hardcoded validation with database-driven generic engine |

---

## Summary

Phase 5 completes the admin pose system by making the therapy session fully dynamic. Admins can now:

1. **Record** custom exercises (Phase 3)
2. **Refine** angle criteria and rules (Phase 4)
3. **Deploy** exercises to patients (Phase 5) ✅

Patients see exercises load automatically from the database, with validation logic, feedback messages, hold durations, and instructions all driven by the `pose_criteria` JSON saved by the admin.

**The system is now complete and ready for testing.**
