// Calorie and macro targets from the Mifflin-St Jeor equation.
import { LB_PER_KG } from './units.js';

export const ACTIVITY = {
  sedentary: { factor: 1.2, label: 'Mostly sitting', hint: 'Desk job, little exercise' },
  light: { factor: 1.375, label: 'Lightly active', hint: 'Exercise 1–3 days a week' },
  moderate: { factor: 1.55, label: 'Active', hint: 'Exercise 3–5 days a week' },
  very: { factor: 1.725, label: 'Very active', hint: 'Hard exercise 6–7 days a week' },
  athlete: { factor: 1.9, label: 'Athlete', hint: 'Training twice a day or a physical job' },
};

// Weekly weight change in lb. One pound of body weight is roughly 3,500 kcal, so 500 kcal a day.
export const PACES = [
  { value: -1.5, label: 'Lose 1.5 lb / week' },
  { value: -1, label: 'Lose 1 lb / week' },
  { value: -0.5, label: 'Lose 0.5 lb / week' },
  { value: 0, label: 'Maintain' },
  { value: 0.5, label: 'Gain 0.5 lb / week' },
  { value: 1, label: 'Gain 1 lb / week' },
];
export const paceLabel = (value, metric) => {
  if (!value) return 'Maintain';
  const amount = metric ? `${Math.abs(Math.round(value / LB_PER_KG * 100) / 100)} kg` : `${Math.abs(value)} lb`;
  return `${value < 0 ? 'Lose' : 'Gain'} ${amount} / week`;
};

export const ageFrom = (birthYear) => (birthYear ? new Date().getFullYear() - birthYear : null);

// Returns null until sex, age, height and weight are all known.
export function calorieTarget({ sex, birthYear, heightCm, weightKg, activity = 'moderate', goalPace = 0 }) {
  const age = ageFrom(birthYear);
  if (!sex || !age || !heightCm || !weightKg) return null;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
  const tdee = bmr * (ACTIVITY[activity] || ACTIVITY.moderate).factor;
  const floor = sex === 'male' ? 1500 : 1200;
  const target = Math.max(floor, tdee + goalPace * 500);
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), target: Math.round(target / 10) * 10 };
}

// Protein about 0.8 g per lb of body weight, fat 28% of calories, carbs the rest.
export function macroTargets(calories, weightKg) {
  const protein = Math.round(Math.min((weightKg || 70) * LB_PER_KG * 0.8, (calories * 0.35) / 4));
  const fat = Math.round((calories * 0.28) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { protein, carbs, fat };
}

// The member's goals, with sensible defaults when they haven't set any.
export function goalsFor(me) {
  const macros = macroTargets(me.calorieGoal, me.weightKg);
  return {
    calories: me.calorieGoal,
    protein: me.proteinGoal ?? macros.protein,
    carbs: me.carbsGoal ?? macros.carbs,
    fat: me.fatGoal ?? macros.fat,
    water: me.waterGoal ?? 8,
  };
}
