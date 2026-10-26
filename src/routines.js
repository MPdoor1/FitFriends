// Routines: saved workouts made of steps, repeated for some number of rounds.
//   { kind: 'sets',  name, sets, reps, weightKg, restSec }   lifting: sets × reps, rest between sets
//   { kind: 'timed', name, seconds }                          a timed move (plank, run, burpees)
//   { kind: 'rest',  seconds }                                a rest break
// The player walks through flatten(routine): one item per set, timed move or rest.

export const STEP_KINDS = { sets: 'Exercise', timed: 'Timed', rest: 'Rest' };

const sets = (name, n, reps, restSec) => ({ kind: 'sets', name, sets: n, reps, weightKg: null, restSec });
const timed = (name, seconds) => ({ kind: 'timed', name, seconds });
const rest = (seconds) => ({ kind: 'rest', seconds });

export const STARTERS = [
  {
    id: 'starter-tabata', name: 'Tabata Burner', type: 'HIIT', intensity: 'hard', rounds: 8,
    notes: '20 seconds all-out, 10 seconds rest, 8 rounds. Burpees, squat jumps or sprints.',
    steps: [timed('All out', 20), rest(10)],
  },
  {
    id: 'starter-7min', name: '7-Minute Workout', type: 'HIIT', intensity: 'moderate', rounds: 1,
    notes: 'The classic: 12 moves, 30 seconds each, 10 seconds to switch.',
    steps: ['Jumping jacks', 'Wall sit', 'Push-ups', 'Crunches', 'Step-ups', 'Squats', 'Triceps dips', 'Plank', 'High knees', 'Lunges', 'Push-up with rotation', 'Side plank']
      .flatMap((n, i, a) => (i < a.length - 1 ? [timed(n, 30), rest(10)] : [timed(n, 30)])),
  },
  {
    id: 'starter-push', name: 'Push Day', type: 'Weightlifting', intensity: 'hard', rounds: 1,
    notes: 'Chest, shoulders and triceps.',
    steps: [sets('Bench Press', 4, 8, 90), sets('Overhead Press', 3, 8, 90), sets('Incline Dumbbell Press', 3, 10, 75), sets('Lateral Raise', 3, 12, 60), sets('Tricep Pushdown', 3, 12, 60)],
  },
  {
    id: 'starter-pull', name: 'Pull Day', type: 'Weightlifting', intensity: 'hard', rounds: 1,
    notes: 'Back and biceps.',
    steps: [sets('Deadlift', 3, 5, 120), sets('Pull-up', 3, 8, 90), sets('Barbell Row', 3, 8, 90), sets('Face Pull', 3, 15, 60), sets('Barbell Curl', 3, 10, 60)],
  },
  {
    id: 'starter-legs', name: 'Leg Day', type: 'Weightlifting', intensity: 'hard', rounds: 1,
    notes: 'Quads, hamstrings, glutes and calves.',
    steps: [sets('Squat', 4, 6, 120), sets('Romanian Deadlift', 3, 8, 90), sets('Leg Press', 3, 10, 90), sets('Leg Curl', 3, 12, 60), sets('Calf Raise', 4, 15, 45)],
  },
  {
    id: 'starter-dumbbell', name: 'Full Body Dumbbells', type: 'Weightlifting', intensity: 'moderate', rounds: 1,
    notes: 'Everything with one pair of dumbbells.',
    steps: [sets('Dumbbell Bench Press', 3, 10, 60), sets('Dumbbell Row', 3, 10, 60), sets('Bulgarian Split Squat', 3, 8, 60), sets('Dumbbell Shoulder Press', 3, 10, 60), sets('Hammer Curl', 2, 12, 45)],
  },
  {
    id: 'starter-core', name: 'Core 10', type: 'Other', intensity: 'moderate', rounds: 2,
    notes: 'Ten minutes of abs, twice through.',
    steps: [timed('Plank', 45), rest(15), timed('Russian Twist', 40), rest(15), timed('Hanging Leg Raise', 40), rest(15), timed('Crunch', 40), rest(15)],
  },
  {
    id: 'starter-runwalk', name: 'Run/Walk Intervals', type: 'Running', intensity: 'moderate', rounds: 1,
    notes: 'Beginner-friendly: warm up, 6 × (1 min run, 90 s walk), cool down.',
    steps: [timed('Warm-up walk', 300), ...Array.from({ length: 6 }, () => [timed('Run', 60), timed('Walk', 90)]).flat(), timed('Cool-down walk', 300)],
  },
  {
    id: 'starter-emom', name: 'EMOM 12', type: 'HIIT', intensity: 'hard', rounds: 12,
    notes: 'Every minute on the minute: 10 kettlebell swings (or 10 burpees), rest for what is left of the minute.',
    steps: [timed('10 swings, then rest', 60)],
  },
];

// One entry per thing the player shows. Trailing rests are dropped; the last set has no rest after it.
export function flatten(routine) {
  const items = [];
  const rounds = Math.max(1, routine.rounds || 1);
  for (let r = 1; r <= rounds; r++) {
    for (const step of routine.steps) {
      if (step.kind === 'sets') {
        for (let s = 1; s <= step.sets; s++) {
          items.push({ kind: 'set', name: step.name, set: s, sets: step.sets, reps: step.reps, weightKg: step.weightKg ?? null, rest: step.restSec || 0, round: r });
        }
      } else if (step.kind === 'timed') {
        items.push({ kind: 'timed', name: step.name, seconds: step.seconds, round: r });
      } else if (step.kind === 'rest') {
        items.push({ kind: 'rest', name: 'Rest', seconds: step.seconds, round: r });
      }
    }
  }
  while (items.length && items[items.length - 1].kind === 'rest') items.pop();
  if (items.length && items[items.length - 1].kind === 'set') items[items.length - 1] = { ...items[items.length - 1], rest: 0 };
  return items;
}

// Rough length: about 3 seconds per rep plus rest; timed steps as written.
export function estimateSeconds(routine) {
  return flatten(routine).reduce((t, it) => t + (it.kind === 'set' ? it.reps * 3 + it.rest : it.seconds), 0);
}

export function summary(routine) {
  const ex = routine.steps.filter((s) => s.kind !== 'rest').length;
  const mins = Math.max(1, Math.round(estimateSeconds(routine) / 60));
  return `${ex} ${ex === 1 ? 'move' : 'moves'} · ~${mins} min${routine.rounds > 1 ? ` · ${routine.rounds} rounds` : ''}`;
}

export const clock = (sec) => {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

// Quick timers become tiny routines so they run in the same player.
export const intervalRoutine = (work, restSec, rounds) => ({
  id: null, name: `Intervals ${work}s/${restSec}s × ${rounds}`, type: 'HIIT', intensity: 'hard', rounds, kind: 'timer',
  steps: restSec ? [timed('Work', work), rest(restSec)] : [timed('Work', work)],
});
export const countdownRoutine = (seconds) => ({
  id: null, name: `Countdown ${clock(seconds)}`, type: 'Other', intensity: 'moderate', rounds: 1, kind: 'timer',
  steps: [timed('Countdown', seconds)],
});
