// Workout catalog with MET values (metabolic equivalents) used to estimate calories burned.
export const WORKOUT_TYPES = [
  { name: 'Running', met: 9.8 },
  { name: 'Walking', met: 3.5 },
  { name: 'Cycling', met: 7.5 },
  { name: 'Swimming', met: 7.0 },
  { name: 'Weightlifting', met: 5.0 },
  { name: 'HIIT', met: 8.0 },
  { name: 'Yoga', met: 2.8 },
  { name: 'Hiking', met: 6.0 },
  { name: 'Sports', met: 7.0 },
  { name: 'Dance', met: 5.5 },
  { name: 'Rowing', met: 7.0 },
  { name: 'Climbing', met: 8.0 },
  { name: 'Stretching', met: 2.3 },
  { name: 'Other', met: 5.0 },
];

// Intensity scales both the calorie estimate and the points earned per minute.
export const INTENSITY = {
  light: { met: 0.75, points: 1, label: 'Light' },
  moderate: { met: 1, points: 1.5, label: 'Moderate' },
  hard: { met: 1.3, points: 2, label: 'Hard' },
};

export function workoutCalories(type, intensity, minutes, weightKg) {
  const met = (WORKOUT_TYPES.find((t) => t.name === type)?.met ?? 5) * INTENSITY[intensity].met;
  return Math.round(met * weightKg * (minutes / 60));
}

export function workoutPoints(intensity, minutes) {
  return Math.round(Math.min(minutes, 300) * INTENSITY[intensity].points);
}

// Logging food earns 5 points; finishing the day between 70% and 105% of the goal earns 25.
export const GOAL_DAY_POINTS = 25;
export function goalDayPoints(total, goal) {
  if (total <= 0) return 0;
  return total >= goal * 0.7 && total <= goal * 1.05 ? GOAL_DAY_POINTS : 5;
}

const LEVELS = ['Couch Potato', 'Rookie', 'Mover', 'Grinder', 'Athlete', 'Machine', 'Beast', 'Titan', 'Legend', 'Olympian'];

// Level L starts at 50 * L * (L - 1) XP: 0, 100, 300, 600, 1000, ...
export function levelFor(xp) {
  let level = 1;
  while (50 * (level + 1) * level <= xp) level++;
  const floor = 50 * level * (level - 1);
  const next = 50 * (level + 1) * level;
  return {
    number: level,
    title: LEVELS[Math.min(level - 1, LEVELS.length - 1)],
    progress: (xp - floor) / (next - floor),
    toNext: next - xp,
  };
}

const BADGES = [
  { id: 'first', icon: 'sparkles', name: 'First Sweat', desc: 'Log your first workout', test: (s) => s.workouts >= 1 },
  { id: 'ten', icon: 'hash', name: 'Double Digits', desc: 'Log 10 workouts', test: (s) => s.workouts >= 10 },
  { id: 'fifty', icon: 'medal', name: 'Half Century', desc: 'Log 50 workouts', test: (s) => s.workouts >= 50 },
  { id: 'streak3', icon: 'flame', name: 'Heating Up', desc: '3-day workout streak', test: (s) => s.bestStreak >= 3 },
  { id: 'streak7', icon: 'trend', name: 'Unstoppable', desc: '7-day workout streak', test: (s) => s.bestStreak >= 7 },
  { id: 'min1000', icon: 'timer', name: '1000 Club', desc: '1,000 total workout minutes', test: (s) => s.minutes >= 1000 },
  { id: 'fuel', icon: 'salad', name: 'Fuel Master', desc: 'Hit your calorie target 10 days', test: (s) => s.goalDays >= 10 },
  { id: 'variety', icon: 'shuffle', name: 'Mix It Up', desc: 'Try 5 different workout types', test: (s) => s.types >= 5 },
  { id: 'burn', icon: 'gauge', name: 'Furnace', desc: 'Burn 10,000 calories total', test: (s) => s.calories >= 10000 },
];

export function badgesFor(stats) {
  return BADGES.map(({ test, ...b }) => ({ ...b, earned: test(stats) }));
}
