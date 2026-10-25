# 💪 FitFriends

A small health app for a group of friends: log workouts, count calories, and compete in the Arena.

**Live site:** https://mpdoor1.github.io/FitFriends/

- **Accounts:** a username and password. No email or verification.
- **Workouts:** type, minutes, intensity, optional distance and notes. Calories burned are estimated from MET values and your weight.
- **Calories:** a daily log by meal with quick-add foods, your recent foods, a daily goal, and protein tracking.
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
5. **Optional: add an invite code** (recommended, because the site is public). In Firestore → **Data**, click **Start collection**:
   - Collection ID: `config`
   - Document ID: `private`
   - Field: `inviteCode` (string), with any phrase as the value.

   After that, new accounts need that code. To change it, edit the field. To turn it off, delete the document.

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
| `users/{uid}/foods/{id}` | One food entry |
| `days/{uid}_{date}` | Daily totals per person. The Arena reads these, which keeps reads well inside the free quota |
| `config/private` | Optional `inviteCode`. Only the security rules can read it |
