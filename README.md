# 💪 FitFriends

A small health app for a group of friends: log workouts, count calories, and compete in the Arena.

- **Accounts:** a username and password. No email or verification. Passwords are hashed with scrypt.
- **Workouts:** type, minutes, intensity, optional distance and notes. Calories burned are estimated from MET values and your weight.
- **Calories:** a daily log by meal with quick-add foods, your recent foods, a daily goal, and protein tracking.
- **Arena:** an animated race track, a podium, a daily points heatmap, head-to-head stat bars, levels, XP and badges.

**Stack:** Node 22 + Express, with SQLite built into Node (`node:sqlite`) and a plain HTML/JS frontend. There is no build step.

## Scoring
| Action | Points |
|---|---|
| Workout | 1 pt/min light · 1.5 moderate · 2 hard (max 300 min) |
| Any food logged that day | +5 |
| Day total between 70% and 105% of your calorie goal | +25 (replaces the +5) |

Your all-time points are your XP, and XP sets your level (Couch Potato → Olympian).

## Run locally
```bash
npm install
npm start            # http://localhost:3000
```
Data is stored in `./data/fitfriends.db`.

## Deploy free on Azure (one-time setup)
1. **Create the web app.** In the Azure Portal, go to **Create a resource → Web App**.
   - Publish: **Code** · Runtime stack: **Node 22 LTS** · Operating system: **Linux**
   - Pricing plan: **Free F1** (choose *Explore pricing plans* if F1 isn't shown). This costs $0.
   - The name you pick becomes `https://<name>.azurewebsites.net`.
2. **Allow publish-profile deploys.** Open the web app, then go to **Settings → Configuration → General settings** and turn **SCM Basic Auth Publishing Credentials** **On**. Save.
3. **Optional: add an invite code.** Under **Settings → Environment variables**, add `INVITE_CODE` with any phrase. Only people who know it can create accounts. This is recommended because the URL is public.
4. **Download the publish profile** from the web app's **Overview** page.
5. **Add the GitHub settings.** In the GitHub repo, go to **Settings → Secrets and variables → Actions**:
   - Under **Secrets**, add `AZURE_WEBAPP_PUBLISH_PROFILE` and paste the whole downloaded file.
   - Under **Variables**, add `AZURE_WEBAPP_NAME` and set it to your web app's name.
6. Push to `main`, or run the **Deploy to Azure App Service** workflow from the Actions tab.

The database lives in `/home/data` on the App Service, so it survives restarts and redeploys.

**Free tier notes:** the app sleeps after about 20 minutes idle, so the first visit after a break takes a few seconds. The F1 plan includes 60 CPU-minutes/day, which is plenty for a handful of friends.

To back up the data, use the web app's **Advanced Tools (Kudu) → Debug console**, go to `/home/data`, and download `fitfriends.db`.
