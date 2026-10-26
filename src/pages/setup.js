import * as store from '../store.js';
import { state } from '../state.js';
import { ACTIVITY, PACES, paceLabel, calorieTarget, macroTargets, ageFrom } from '../nutrition.js';
import { $, $$, esc, fmt, icon, label, localDate, toast, haptic, stepper, bindSteppers } from '../ui.js';
import { imperial, weightUnit, toDisplayWeight, fromDisplayWeight, heightParts, heightFromParts } from '../units.js';

// Guided goal setup: units → about you → activity → goal → your targets.
export async function viewSetup(app) {
  const me = state.user;
  const s = {
    step: 0,
    units: me.units || 'imperial',
    sex: me.sex,
    age: ageFrom(me.birthYear) || 30,
    heightCm: me.heightCm || 172,
    weightKg: me.weightKg || 75,
    activity: me.activity || 'moderate',
    goalWeightKg: me.goalWeightKg,
    goalPace: me.goalPace ?? 0,
  };
  const STEPS = ['Units', 'About you', 'Activity', 'Goal', 'Your plan'];

  const draw = () => {
    const u = s.units;
    const h = heightParts(s.heightCm, u);
    let body = '';
    if (s.step === 0) {
      body = `
        <h1>Pounds or kilos?</h1>
        <p class="muted lead">You can switch any time in your profile.</p>
        <div class="options">
          ${[['imperial', 'Pounds & miles', 'lb · ft/in · mi'], ['metric', 'Kilos & kilometres', 'kg · cm · km']].map(([k, t, d]) => `
            <button type="button" class="option ${s.units === k ? 'on' : ''}" data-units="${k}"><strong>${t}</strong><span class="muted">${d}</span>${icon('check', 20)}</button>`).join('')}
        </div>`;
    } else if (s.step === 1) {
      body = `
        <h1>About you</h1>
        <p class="muted lead">Used only to estimate how many calories you burn. Friends can't see it.</p>
        <div class="stack">
          <div><span class="field-label">Sex</span><div class="seg">${[['male', 'Male'], ['female', 'Female']].map(([k, l]) => `<button type="button" data-sex="${k}" class="${s.sex === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <div><span class="field-label">Age</span>${stepper('age', s.age, { min: 10, max: 100, unit: 'years' })}</div>
          <div><span class="field-label">Height</span>
            ${imperial(u)
              ? `<div class="fields">${stepper('ft', h.ft, { min: 3, max: 8, unit: 'ft' })}${stepper('in', h.in, { min: 0, max: 11, unit: 'in' })}</div>`
              : stepper('cm', h.cm, { min: 100, max: 230, unit: 'cm' })}
          </div>
          <div><span class="field-label">Current weight</span>${stepper('weight', toDisplayWeight(s.weightKg, u), { step: imperial(u) ? 1 : 0.5, min: 20, max: 700, unit: weightUnit(u), decimals: 1 })}</div>
        </div>`;
    } else if (s.step === 2) {
      body = `
        <h1>How active are you?</h1>
        <p class="muted lead">Think about a normal week, including workouts.</p>
        <div class="options">
          ${Object.entries(ACTIVITY).map(([k, a]) => `
            <button type="button" class="option ${s.activity === k ? 'on' : ''}" data-activity="${k}"><strong>${a.label}</strong><span class="muted">${a.hint}</span>${icon('check', 20)}</button>`).join('')}
        </div>`;
    } else if (s.step === 3) {
      body = `
        <h1>What's the goal?</h1>
        <p class="muted lead">Pick a pace you can keep up. Slow and steady sticks.</p>
        <div class="options">
          ${PACES.map((p) => `
            <button type="button" class="option ${s.goalPace === p.value ? 'on' : ''}" data-pace="${p.value}"><strong>${paceLabel(p.value, !imperial(u))}</strong>${icon('check', 20)}</button>`).join('')}
        </div>
        <div class="stack" style="margin-top:18px">
          <div><span class="field-label">Goal weight <span class="opt">optional</span></span>${stepper('goalWeight', s.goalWeightKg != null ? toDisplayWeight(s.goalWeightKg, u) : '', { step: 1, min: 20, max: 700, unit: weightUnit(u), decimals: 1 })}</div>
        </div>`;
    } else {
      const plan = calorieTarget({ ...s, birthYear: new Date().getFullYear() - s.age });
      const macros = macroTargets(plan.target, s.weightKg);
      body = `
        <h1>Your daily plan</h1>
        <div class="plan-hero">
          <strong class="num">${fmt(plan.target)}</strong><span>calories a day</span>
        </div>
        <div class="plan-macros">
          <div><b class="num">${macros.protein}g</b><span>Protein</span></div>
          <div><b class="num">${macros.carbs}g</b><span>Carbs</span></div>
          <div><b class="num">${macros.fat}g</b><span>Fat</span></div>
          <div><b class="num">8</b><span>Water</span></div>
        </div>
        <ul class="plan-why muted small">
          <li>Your body burns about <b>${fmt(plan.bmr)}</b> kcal at rest and <b>${fmt(plan.tdee)}</b> on a normal day.</li>
          <li>${s.goalPace ? `To ${s.goalPace < 0 ? 'lose' : 'gain'} ${paceLabel(s.goalPace, !imperial(u)).replace(/^(Lose|Gain) /, '').replace(' / week', '')} a week you eat about ${fmt(Math.abs(s.goalPace) * 500)} kcal ${s.goalPace < 0 ? 'less' : 'more'} than that.` : 'Eating this much keeps your weight steady.'}</li>
          <li>Workouts you log add their calories back on that day.</li>
          <li>You can fine-tune any of these in your profile.</li>
        </ul>`;
    }

    app.innerHTML = `
      <section class="wizard">
        <div class="wizard-top">
          <button type="button" class="back" id="w-back" ${s.step === 0 ? 'hidden' : ''}>${icon('left', 18)} Back</button>
          <button type="button" class="text-btn" id="w-skip">${s.step === STEPS.length - 1 ? '' : 'Skip for now'}</button>
        </div>
        <div class="progress">${STEPS.map((n, i) => `<span class="${i <= s.step ? 'on' : ''}" title="${n}"></span>`).join('')}</div>
        ${label(`Step ${s.step + 1} of ${STEPS.length} · ${STEPS[s.step]}`)}
        <div class="wizard-body">${body}</div>
        <p class="form-error" id="w-error"></p>
        <button type="button" class="btn primary big full" id="w-next">${s.step === STEPS.length - 1 ? `${icon('check', 20)} Use this plan` : 'Continue'}</button>
      </section>`;

    bindSteppers(app);
    $$('[data-units]').forEach((b) => b.addEventListener('click', () => { s.units = b.dataset.units; haptic(5); draw(); }));
    $$('[data-sex]').forEach((b) => b.addEventListener('click', () => { s.sex = b.dataset.sex; $$('[data-sex]').forEach((x) => x.classList.toggle('on', x === b)); }));
    $$('[data-activity]').forEach((b) => b.addEventListener('click', () => { s.activity = b.dataset.activity; haptic(5); draw(); }));
    $$('[data-pace]').forEach((b) => b.addEventListener('click', () => { readInputs(); s.goalPace = Number(b.dataset.pace); haptic(5); draw(); }));
    $('#w-back')?.addEventListener('click', () => { readInputs(); s.step -= 1; draw(); });
    $('#w-skip').addEventListener('click', skip);
    $('#w-next').addEventListener('click', next);
  };

  const val = (name) => $(`[name="${name}"]`, app)?.value;
  const readInputs = () => {
    const u = s.units;
    if (s.step === 1) {
      s.age = Number(val('age'));
      s.heightCm = heightFromParts(imperial(u) ? { ft: val('ft'), in: val('in') } : { cm: val('cm') }, u);
      s.weightKg = fromDisplayWeight(val('weight'), u);
    }
    if (s.step === 3) {
      const g = val('goalWeight');
      s.goalWeightKg = g ? fromDisplayWeight(g, u) : null;
    }
  };

  const next = async () => {
    readInputs();
    const err = $('#w-error');
    if (s.step === 1) {
      if (!s.sex) { err.textContent = 'Pick male or female for the calorie estimate.'; return; }
      if (!(s.age >= 10 && s.age <= 100)) { err.textContent = 'Age should be between 10 and 100.'; return; }
      if (!(s.heightCm >= 100 && s.heightCm <= 240)) { err.textContent = 'That height looks off.'; return; }
      if (!(s.weightKg >= 25 && s.weightKg <= 300)) { err.textContent = 'That weight looks off.'; return; }
    }
    if (s.step === 3 && s.goalWeightKg != null && !s.goalPace) {
      // Nudge the pace to match the goal if they left it on maintain.
      if (s.goalWeightKg < s.weightKg - 1) s.goalPace = -1;
      else if (s.goalWeightKg > s.weightKg + 1) s.goalPace = 0.5;
    }
    if (s.step < STEPS.length - 1) { s.step += 1; draw(); window.scrollTo(0, 0); return; }

    const btn = $('#w-next');
    btn.disabled = true;
    try {
      const plan = calorieTarget({ ...s, birthYear: new Date().getFullYear() - s.age });
      const macros = macroTargets(plan.target, s.weightKg);
      state.user = await store.updateProfile({
        units: s.units, sex: s.sex, birthYear: new Date().getFullYear() - s.age, heightCm: s.heightCm,
        weightKg: s.weightKg, activity: s.activity, goalPace: s.goalPace, goalWeightKg: s.goalWeightKg,
        calorieGoal: plan.target, proteinGoal: macros.protein, carbsGoal: macros.carbs, fatGoal: macros.fat,
        waterGoal: state.user.waterGoal || 8, onboarded: true,
      });
      // Record the weight they entered as today's weigh-in so the chart has a starting point.
      if (Math.abs((me.weightKg || 0) - s.weightKg) > 0.05 || !(await store.listWeights()).length) {
        await store.addWeight(localDate(), s.weightKg);
        state.user = await store.getProfile();
      }
      haptic(25);
      toast(`You're set: ${fmt(plan.target)} kcal a day`);
      location.hash = '#/home';
    } catch (e) {
      $('#w-error').textContent = e.message;
      btn.disabled = false;
    }
  };

  const skip = async () => {
    state.user = await store.updateProfile({ onboarded: true, units: s.units });
    location.hash = '#/home';
  };

  draw();
}
