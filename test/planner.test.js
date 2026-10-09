import test from 'node:test';
import assert from 'node:assert/strict';
import { estimate, recommend, category } from '../public/planner.js';
import { demoNutrition } from '../lib/demo.js';

const profile = {
  height: 175, weight: 70, age: 28, sex: 'male', shape: 'balanced',
  activity: 'sedentary', training: 'strength', minutes: 45, eaten: 800,
  share: 0.35, adultGeneralHealth: true
};

test('height, weight, shape and training produce reproducible estimates without body fat input', () => {
  const result = estimate(profile);
  assert.equal(result.bmi, 22.9);
  assert.equal(result.bmr, 1659);
  assert.equal(result.exercise, 138);
  assert.equal(result.daily, 2128);
  assert.equal(result.budget, 744);
  assert.equal(result.remaining, 1328);
  assert.deepEqual(result.bodyFat, [12, 32]);
  assert.deepEqual(result.exerciseRange, [96, 179]);
});

test('subjective shape changes uncertainty, not calories or food entitlement', () => {
  const slim = estimate({ ...profile, shape: 'slim' });
  const soft = estimate({ ...profile, shape: 'soft' });
  assert.notDeepEqual(slim.bodyFat, soft.bodyFat);
  assert.equal(slim.budget, soft.budget);
});

test('rest day has no extra exercise even with stale minutes', () => {
  const result = estimate({ ...profile, training: 'rest', minutes: 120 });
  assert.equal(result.exercise, 0);
  assert.equal(result.daily, result.baseline);
});

test('net MET subtracts resting energy and is not counted twice', () => {
  const result = estimate({ ...profile, training: 'run', minutes: 60 });
  const baseline = (10 * 70 + 6.25 * 175 - 5 * 28 + 5) * 1.2;
  const exercise = (8.3 - 1) * 3.5 * 70 / 200 * 60;
  assert.equal(result.daily, Math.round(baseline + exercise));
  assert.equal(result.budget, Math.floor((baseline + exercise) * 0.35));
});

test('remaining reference constrains a meal, with no negative budgets', () => {
  assert.equal(estimate({ ...profile, eaten: 2000 }).budget, 128);
  assert.equal(estimate({ ...profile, eaten: 4000 }).budget, 0);
  assert.deepEqual(recommend(demoNutrition().foods, 0), []);
});

test('invalid and out-of-scope data are rejected explicitly', () => {
  for (const patch of [
    { age: 17 }, { age: 66 }, { weight: NaN }, { height: Infinity },
    { weight: 0 }, { minutes: -1 }, { minutes: 181 }, { share: 1 },
    { eaten: -1 }, { adultGeneralHealth: false }, { weight: '70' },
    { sex: 'unknown' }, { training: '__proto__' }, { shape: 'constructor' },
    { activity: 'unknown' }, { weight: 40 }, { weight: 110 }
  ]) assert.throws(() => estimate({ ...profile, ...patch }));
});

test('meal search respects numeric upper/lower bounds, exclusions and one item per category', () => {
  const foods = demoNutrition().foods;
  for (const preference of ['balanced', 'protein', 'sodium']) {
    for (let budget = 0; budget <= 1500; budget += 13) {
      const meals = recommend(foods, budget, preference, ['演示薯条']);
      assert.ok(meals.length <= 3);
      assert.equal(new Set(meals.map(meal => meal.items[0].name)).size, meals.length);
      for (const meal of meals) {
        assert.ok(meal.totals.energyKcal <= budget);
        assert.ok(meal.totals.energyKcal >= budget * 0.65);
        assert.equal(meal.totals.energyKcal, meal.items.reduce((sum, item) => sum + item.energyKcal, 0));
        assert.equal(category(meal.items[0].name), 'main');
        assert.equal(new Set(meal.items.map(item => category(item.name))).size, meal.items.length);
        assert.ok(!meal.items.some(item => item.name === '演示薯条'));
      }
    }
  }
});

test('fully excluded menu returns no fabricated recommendations', () => {
  const foods = demoNutrition().foods;
  assert.deepEqual(recommend(foods, 700, 'balanced', foods.map(food => food.name)), []);
});

test('ranking follows stated protein and sodium preferences', () => {
  const foods = demoNutrition().foods;
  for (const [preference, field, direction] of [['protein', 'protein', -1], ['sodium', 'sodium', 1]]) {
    const result = recommend(foods, 700, preference);
    assert.equal(result.length, 3);
    for (let i = 1; i < result.length; i++) {
      assert.ok(direction * result[i - 1].totals[field] <= direction * result[i].totals[field]);
    }
  }
});
