import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNutrition } from '../lib/nutrition.js';

const table = '[2]{productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:\n  演示汉堡,null,1674,400,20,15,40,700,80\n  演示水,null,0,0,0,0,0,0,0';
const payload = data => ({ code: 200, success: true, data });

test('parses observed structuredContent TOON shape with zero values preserved', () => {
  const foods = parseNutrition({ structuredContent: payload(table) });
  assert.equal(foods.length, 2);
  assert.equal(foods[0].energyKcal, 400);
  assert.equal(foods[0].sodium, 700);
  assert.equal(foods[1].energyKcal, 0);
});

test('supports observed markdown-wrapped JSON and plain JSON content', () => {
  for (const prefix of ['', '# API Response Information\n\n## Original Response\n\n']) {
    const foods = parseNutrition({ content: [{ type: 'text', text: prefix + JSON.stringify(payload(table)) }] });
    assert.equal(foods.length, 2);
  }
});

test('removes identical duplicates without changing serving values', () => {
  const data = table.replace('演示水,null,0,0,0,0,0,0,0', '演示汉堡,null,1674,400,20,15,40,700,80');
  assert.equal(parseNutrition({ structuredContent: payload(data) }).length, 1);
});

test('refuses conflicting portions, incomplete fields, bad counts, errors and blank responses', () => {
  for (const result of [
    { isError: true }, {},
    { structuredContent: { code: 401, data: table } },
    { structuredContent: payload(table.replace('[2]', '[3]')) },
    { structuredContent: payload(table.replace(',400,', ',null,')) },
    { structuredContent: payload(table.replace(',400,', ',-1,')) },
    { structuredContent: payload(table.replace('演示水', '演示汉堡')) },
    { structuredContent: payload('[]') },
    { content: [{ type: 'text', text: 'not JSON' }] }
  ]) assert.throws(() => parseNutrition(result));
});
