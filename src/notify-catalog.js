// Every kind of notification, shared by the app (settings, previews) and scripts/notify.mjs (sending).
// No browser or Node APIs here so both sides can import it.

export const NOTIFY_GROUPS = [
  { id: 'reminders', label: 'Reminders', desc: 'Nudges to log food, water, workouts and weight' },
  { id: 'progress', label: 'Progress & fun', desc: 'Level-ups, badges, goals hit and recaps' },
  { id: 'arena', label: 'Arena', desc: 'Leaderboard changes and weekly results' },
  { id: 'friends', label: 'Friends', desc: 'What your friends are up to, and nudges' },
];

// on: default for new members. when: shown in settings (member's local time).
export const NOTIFY_TYPES = [
  // Reminders
  { key: 'morning', group: 'reminders', on: false, label: 'Morning kickoff', when: '7:30–9:30am', desc: "Yesterday's numbers and today's calorie target", sample: ['Good morning, Kaden', "Yesterday: 45 min trained, 2,140 kcal eaten. Today's target: 2,260 kcal."] },
  { key: 'breakfast', group: 'reminders', on: false, label: 'Breakfast', when: '9–10:30am', desc: 'If nothing is logged yet', sample: ['Breakfast logged?', "Start today's log: it's +5 pts the moment you add anything."] },
  { key: 'lunch', group: 'reminders', on: true, label: 'Lunch', when: '1–3pm', desc: 'If nothing is logged yet', sample: ['Nothing in your food log yet', 'Tap to log breakfast or lunch. Logging anything earns +5 pts.'] },
  { key: 'dinner', group: 'reminders', on: true, label: 'Dinner', when: '7:30–9:30pm', desc: 'If dinner is missing, with calories left', sample: ["What's for dinner?", 'You have 840 kcal left today. Log dinner to stay on target.'] },
  { key: 'eveningLog', group: 'reminders', on: false, label: 'Evening top-up', when: '9–10pm', desc: "If you're well under target, in case you forgot something", sample: ['620 kcal under target', 'Log anything you missed. Landing 70–105% of your goal is +25 pts.'] },
  { key: 'waterAm', group: 'reminders', on: false, label: 'First glass', when: '11am–12:30pm', desc: 'If you have no water logged', sample: ['First glass of water?', 'Nothing logged yet today. Tap a glass in FitFriends.'] },
  { key: 'waterPm', group: 'reminders', on: true, label: 'Water check', when: '3–5pm', desc: "If you're under half your glasses", sample: ['Water check', '2 of 8 glasses so far. Grab one now.'] },
  { key: 'workout', group: 'reminders', on: true, label: 'Workout reminder', when: '6–8:30pm', desc: "If you haven't trained today", sample: ['No workout yet today', 'Keep your 4-day streak alive. Even 20 minutes counts.'] },
  { key: 'streakSaver', group: 'reminders', on: true, label: 'Streak saver', when: '8:45–9:45pm', desc: 'Last call when a 2+ day streak is about to break', sample: ['Last call for your 5-day streak', 'Log any workout before midnight to keep it going.'] },
  { key: 'weighIn', group: 'reminders', on: true, label: 'Weigh-in', when: '8–10am', desc: 'When your last weigh-in is over a week old', sample: ['Time to weigh in', "It's been 8 days. A quick morning weigh-in keeps your chart honest."] },
  // Progress & fun
  { key: 'goalHit', group: 'progress', on: true, label: 'Target hit', when: '9–10pm', desc: 'When your day lands on your calorie target', sample: ['Target hit', '2,190 kcal today: right in your zone. +25 pts.'] },
  { key: 'levelUp', group: 'progress', on: true, label: 'Level up', when: 'Right away', desc: 'When you reach a new level', sample: ['Level up!', "You're now LV 4 · Grinder. 400 XP to the next one."] },
  { key: 'badge', group: 'progress', on: true, label: 'Badge unlocked', when: 'Right away', desc: 'When you earn a new badge', sample: ['Badge unlocked: Heating Up', '3-day workout streak. See it in your profile.'] },
  { key: 'weightMilestone', group: 'progress', on: true, label: 'Weight milestones', when: 'After a weigh-in', desc: 'Every 5 lb (2 kg) toward your goal, and reaching it', sample: ['Down 10 lb', 'Since you started. Only 6 lb to your goal.'] },
  { key: 'weeklySummary', group: 'progress', on: true, label: 'Your week', when: 'Sunday 7–9pm', desc: 'Workouts, minutes, days on target and rank', sample: ['Your week', '4 workouts · 180 min · 5 days on target · #2 in the Arena'] },
  { key: 'monthly', group: 'progress', on: true, label: 'Monthly recap', when: '1st of the month, 9am–noon', desc: 'Last month in numbers', sample: ['October recap', '16 workouts · 720 min · avg 2,180 kcal · down 4.2 lb'] },
  // Arena
  { key: 'arenaPassed', group: 'arena', on: true, label: 'Passed you', when: 'Within ~15 min', desc: 'When someone overtakes you this week', sample: ['Sam just passed you', "You're #2 of 4 this week. 26 pts to take it back."] },
  { key: 'arenaFirst', group: 'arena', on: true, label: 'First place', when: 'Within ~15 min', desc: 'When you take the lead', sample: ["You're in first place!", '312 pts this week. Keep it up.'] },
  { key: 'arenaClose', group: 'arena', on: true, label: 'Close race', when: 'Sunday noon–6pm', desc: "When you're within 40 pts of the spot above", sample: ['Final day: 18 pts behind Sam', 'One solid workout flips it.'] },
  { key: 'weekly', group: 'arena', on: true, label: 'Weekly results', when: 'Monday 8am–noon', desc: 'How last week finished', sample: ["Last week's results", 'You finished #2 of 4 with 412 pts. Jordan won with 455.'] },
  // Friends
  { key: 'friendWorkout', group: 'friends', on: true, label: 'Friend workouts', when: 'Within ~15 min', desc: 'When a friend logs a workout', sample: ['Alex logged Running', '45 min · 5.0 mi · +90 pts'] },
  { key: 'friendPr', group: 'friends', on: true, label: 'Friend records', when: 'Within ~15 min', desc: 'When a friend sets a lifting record', sample: ['Alex set a new record', 'Bench Press 225 lb × 3'] },
  { key: 'friendMilestone', group: 'friends', on: true, label: 'Friend milestones', when: 'Within ~15 min', desc: 'Friends leveling up or earning badges', sample: ['Sam reached LV 5', 'Athlete. Send a nudge to say nice work.'] },
  { key: 'newMember', group: 'friends', on: true, label: 'New members', when: 'Within ~15 min', desc: 'When someone joins the group', sample: ['Jordan joined FitFriends', 'Say hi with a nudge from the Arena.'] },
  { key: 'friendRoutine', group: 'friends', on: true, label: 'Shared routines', when: 'Within ~15 min', desc: 'When a friend shares a workout routine', sample: ['Alex shared a routine: Leg Day', '5 moves · ~42 min. Start it from Train → Routines.'] },
  { key: 'routineUsed', group: 'friends', on: true, label: 'Someone did your routine', when: 'Within ~15 min', desc: 'When a friend finishes a routine you shared', sample: ['Sam did your Leg Day', '48 min · +96 pts'] },
  { key: 'nudges', group: 'friends', on: true, label: 'Nudges & cheers', when: 'Within ~15 min', desc: 'When a friend nudges or cheers you', sample: ['Kaden nudged you', 'Race you this week.'] },
];

export const NOTIFY_KEYS = NOTIFY_TYPES.map((t) => t.key);

// Older settings used broader switches; carry an "off" over to the types it covered.
const LEGACY = {
  meals: ['breakfast', 'lunch', 'dinner', 'eveningLog'],
  water: ['waterAm', 'waterPm'],
  workout: ['workout', 'streakSaver'],
  arena: ['arenaPassed', 'arenaFirst', 'arenaClose'],
  friends: ['friendWorkout', 'friendPr', 'friendMilestone', 'newMember', 'friendRoutine', 'routineUsed'],
};

export const PRESETS = [
  { id: 'recommended', label: 'Recommended', keys: NOTIFY_TYPES.filter((t) => t.on).map((t) => t.key) },
  { id: 'all', label: 'Everything', keys: NOTIFY_KEYS },
  { id: 'reminders', label: 'Reminders only', keys: NOTIFY_TYPES.filter((t) => t.group === 'reminders' && t.on).map((t) => t.key).concat('nudges') },
  { id: 'competition', label: 'Competition only', keys: NOTIFY_TYPES.filter((t) => ['arena', 'friends'].includes(t.group)).map((t) => t.key) },
  { id: 'off', label: 'All off', keys: [] },
];

// The member's settings with defaults filled in: { [key]: bool, quietStart, quietEnd }.
export function notifyPrefs(user) {
  const saved = user?.notify || {};
  const prefs = {};
  for (const t of NOTIFY_TYPES) {
    if (typeof saved[t.key] === 'boolean') prefs[t.key] = saved[t.key];
    else prefs[t.key] = !Object.entries(LEGACY).some(([old, keys]) => saved[old] === false && keys.includes(t.key)) && t.on;
  }
  prefs.quietStart = Number.isInteger(saved.quietStart) ? saved.quietStart : 22;
  prefs.quietEnd = Number.isInteger(saved.quietEnd) ? saved.quietEnd : 8;
  return prefs;
}

export function isQuiet(hour, prefs) {
  const { quietStart: s, quietEnd: e } = prefs;
  if (s === e) return false;
  return s > e ? hour >= s || hour < e : hour >= s && hour < e;
}

export const hourLabel = (h) => (h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`);

export const NUDGES = {
  go: { label: "Let's go!", body: "Let's go! Time to move." },
  streak: { label: 'Your streak misses you', body: 'Your streak misses you.' },
  race: { label: 'Race you this week', body: 'Race you this week.' },
  cheer: { label: 'Great work!', body: 'Great work. Keep it up!' },
};
