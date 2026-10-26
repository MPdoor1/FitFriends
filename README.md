# 💪 FitFriends

A small health app for a group of friends: log workouts, count calories, and compete in the Arena.

**Live site:** https://mpdoor1.github.io/FitFriends/

- **Accounts:** a username and password. No email or verification.
- **Admin:** admins can set the invite code, promote other admins, reset a member's password, and remove members (Me → Admin panel).
- **Password resets:** the admin taps the key next to a member to get a one-time code (valid 24 hours). The member taps **Forgot password?** on the sign-in screen and enters it with a new password. Firebase can't change another person's password without a paid server, so the reset makes a fresh login and moves the member's profile onto it. All their data stays.
- **Notifications:** 25 types in four groups (Reminders, Progress & fun, Arena, Friends), listed in `src/notify-catalog.js`. Turn them on under **Me → Notifications** (on iPhone, install to the Home Screen first). There are one-tap presets, a switch per group, a switch and a Preview button per type, and adjustable quiet hours (default 10pm–8am, member's time zone).
- **Nudges:** send a friend "Let's go!", "Race you this week" and similar from their card in the Arena (one per friend per day).
- **Installable:** add it to your phone's home screen from the Install tab. It opens full screen like a normal app.
- **Setup guide:** after sign-up, five quick steps (units, about you, activity, goal) produce a daily calorie target (Mifflin-St Jeor) plus protein, carbs and fat targets.
- **Units:** pounds and miles by default; switch to kg and km in your profile. Everything is stored metric.
- **Workouts:** 14 types, intensity, duration stepper, distance with live pace or speed, heart rate, notes, and sets × reps × weight for lifting. Shows what you did last time for each exercise and flags new personal records (by estimated 1RM). Edit, "do again", and delete with undo.
- **Calories:** about 120 common foods with protein, carbs and fat, search and categories, your recent foods, custom foods, serving sizes, edit and undo, "same as yesterday" for a meal, macro bars, water glasses, and a 14-day chart against your goal.
- **Routines:** build workouts from lifting sets (sets × reps × weight, rest), timed moves and rest breaks, repeated for any number of rounds. Nine starters are included (Tabata, 7-Minute Workout, Push/Pull/Leg Day, and more). Share a routine with friends; they can start it or save a copy, and you hear when someone does it.
- **Live workout mode:** step-by-step player with countdowns, automatic rest timers, beeps, optional voice cues and vibration. It keeps the screen awake, survives the app closing (the session is kept on the phone), and logs exactly what you did when you finish.
- **Timers:** interval timer with presets (Tabata, EMOM and others), countdown, and a stopwatch with laps.
- **Body weight:** weigh-ins with an interactive chart (1M / 3M / 1Y / All), goal weight, weekly change, BMI. The latest weigh-in drives calorie-burn estimates.
- **Arena:** an animated race track, a podium, a daily points heatmap, head-to-head stat bars, levels, XP and badges.

**Stack:** a static site on GitHub Pages, with Firebase Authentication and Cloud Firestore on the free Spark plan. The `npm run build` step uses esbuild to bundle `src/` (including the Firebase SDK) into `dist/`.

## Scoring
| Action | Points |
|---|---|
| Workout | 1 pt/min light · 1.5 moderate · 2 hard (max 300 min) |
| Any food logged that day | +5 |
| Day total between 70% and 105% of your calorie goal | +25 (replaces the +5) |

Your all-time points are your XP, and XP sets your level (Couch Potato → Olympian). Scores are calculated in the browser, so a determined friend could cheat. This is a friendly game.

## One-time setup

### Firebase (project `fitfriends-b83fa`)
1. **Register a web app.** In the [Firebase console](https://console.firebase.google.com/project/fitfriends-b83fa/settings/general), go to **Project settings → General → Your apps** and click the **Web** (`</>`) icon. Name it `FitFriends` and leave Hosting unchecked. Copy the `firebaseConfig` values into `src/firebase-config.js`. They are not secret.
2. **Turn on sign-in.** Go to **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**. Leave "Email link" off.
3. **Create the database.** Go to **Build → Firestore Database → Create database**. Choose any location (e.g. `nam5`) and **Start in production mode**.
4. **Add the security rules.** In Firestore → **Rules**, replace the contents with [`firestore.rules`](firestore.rules) and click **Publish**.
5. **Make yourself admin.** In Firestore → **Data**, open `users` → your document and add a field `role` (string) = `admin`. After that, set the invite code and manage members from **Me → Admin panel** in the app.

### GitHub Pages
In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. Every push to `main` then builds and deploys the site.

## Local development
```bash
npm install
npm run build && npm run serve      # http://localhost:5173 (uses the real Firebase project)
```
To test without touching real data, run the Firebase emulators (`npx firebase-tools emulators:start`, which needs Java) and open `http://localhost:5173/?emulator`.

## Data layout (Firestore)
| Path | Contents |
|---|---|
| `users/{uid}` | Profile and all-time stats (xp, workouts, minutes, calories, goalDays, types) |
| `users/{uid}/workouts/{id}` | One workout |
| `users/{uid}/foods/{id}` | One food entry (per-serving values plus totals for the servings eaten) |
| `users/{uid}/weights/{date}` | One weigh-in per day, in kg |
| `days/{uid}_{date}` | Daily totals per person. The Arena reads these, which keeps reads well inside the free quota |
| `config/private` | Optional `inviteCode`. Only admins can read or change it |
| `banned/{uid}` | Members removed by an admin |
| `routines/{id}` | Saved routines. Private unless `shared`; friends can only bump `uses` by one |
| `nudges/{id}` | Friend nudges, delivered by the notifier |
| `logins/{username}` | Which login a username currently uses (anyone can look up one username; nobody can list them) |
| `resets/{uid}` | Pending password reset: only a SHA-256 hash of the code plus its expiry. Admins only |
| `aliases/{loginUid}` | Links a login created by a reset to the member's profile |

## Notifications
`.github/workflows/notify.yml` runs `scripts/notify.mjs` every 15 minutes (GitHub may start scheduled runs a few minutes late). The script reads Firestore and sends web push through Firebase Cloud Messaging. It needs one repository secret, `GOOGLE_KEY`, holding a Firebase service account JSON key. Phones register under `users/{uid}/devices/`, and the script keeps its own bookkeeping in `notifyState/`, which no client can read.

Test the decisions without sending anything: run `DRY_RUN=1 GOOGLE_KEY="$(cat key.json)" node scripts/notify.mjs`. Add `NOW=2026-10-26T17:30:00Z` to pretend it's a different time.

GitHub turns scheduled workflows off after 60 days with no commits to the repo. If notifications stop, re-enable **Send notifications** in the Actions tab.
