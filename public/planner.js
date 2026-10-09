export const TRAINING = {
  rest: { name: '今天休息', met: 1 },
  walk: { name: '快走', met: 4.3 },
  strength: { name: '力量训练（一般强度，含组间休息）', met: 3.5 },
  cycle: { name: '骑行（中等强度）', met: 6.8 },
  run: { name: '慢跑（约 8 km/h）', met: 8.3 }
};
const ACTIVITIES = { sedentary: 1.2, light: 1.375, active: 1.55 };
const SHAPES = { slim: [8, 23], balanced: [15, 32], soft: [23, 40] };

function number(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label}需在 ${min}–${max} 之间。`);
  }
  return value;
}

export function estimate(profile) {
  if (!profile || typeof profile !== 'object') throw new Error('请填写基本信息。');
  if (profile.adultGeneralHealth !== true) {
    throw new Error('个性化估算仅适用于一般健康成年人；特殊营养需求请咨询专业人士，可直接查看餐品营养表。');
  }
  const height = number(profile.height, 130, 220, '身高（cm）');
  const weight = number(profile.weight, 35, 200, '体重（kg）');
  const age = number(profile.age, 18, 65, '年龄');
  if (!['male', 'female'].includes(profile.sex) ||
      !Object.hasOwn(SHAPES, profile.shape) ||
      !Object.hasOwn(ACTIVITIES, profile.activity) ||
      !Object.hasOwn(TRAINING, profile.training)) throw new Error('请选择有效的身体资料和活动类型。');
  const minutes = number(profile.minutes, 0, 180, '训练分钟数');
  const eaten = number(profile.eaten, 0, 10000, '今日已摄入热量');
  const share = number(profile.share, 0.2, 0.4, '本餐占全天比例');
  const bmi = weight / (height / 100) ** 2;
  if (bmi < 18.5 || bmi >= 30) {
    throw new Error('当前 BMI 不在本工具个性化模型适用范围（18.5–30）内，请使用营养表并向专业人士咨询；这不是身体状况诊断。');
  }
  const rawFat = 1.2 * bmi + 0.23 * age - (profile.sex === 'male' ? 10.8 : 0) - 5.4;
  // A subjective silhouette can widen uncertainty, never masquerade as a measurement.
  const silhouette = SHAPES[profile.shape];
  const bodyFat = [
    Math.floor(Math.max(5, Math.min(rawFat - 5, silhouette[0]))),
    Math.ceil(Math.min(55, Math.max(rawFat + 5, silhouette[1])))
  ];
  const bmr = 10 * weight + 6.25 * height - 5 * age + (profile.sex === 'male' ? 5 : -161);
  const baseline = bmr * ACTIVITIES[profile.activity];
  const exercise = (TRAINING[profile.training].met - 1) * 3.5 * weight / 200 *
    (profile.training === 'rest' ? 0 : minutes);
  const daily = baseline + exercise;
  const remaining = Math.max(0, daily - eaten);
  // Preserve the unrounded upper bound so recommendations never exceed the model budget.
  const budget = Math.floor(Math.min(daily * share, remaining));
  return {
    bmi: Math.round(bmi * 10) / 10,
    bodyFat,
    bmr: Math.round(bmr),
    baseline: Math.round(baseline),
    exercise: Math.round(exercise),
    exerciseRange: [Math.round(exercise * 0.7), Math.round(exercise * 1.3)],
    daily: Math.round(daily),
    remaining: Math.floor(remaining),
    budget,
    warning: '体脂是粗估范围，不是测量值或统计置信区间；不用于扣减饮食。计划训练未必完成，实际消耗因人而异。超过估算不代表应跳餐或额外运动。'
  };
}

export function category(name) {
  if (/汉堡|麦满分|麦香鸡|麦香鱼|巨无霸|堡|营养卷|叠叠卷/.test(name)) return 'main';
  if (/玉米杯|薯条|苹果片|麦乐鸡/.test(name)) return 'side';
  if (/纯悦|饮用水|纯牛奶|无糖可口可乐|锡兰红茶|伯爵红茶/.test(name)) return 'drink';
  return 'other';
}

export function recommend(foods, budget, preference = 'balanced', excludedNames = []) {
  number(budget, 0, 10000, '本餐参考热量');
  if (!['balanced', 'protein', 'sodium'].includes(preference)) throw new Error('未知搭配偏好。');
  const candidates = foods.filter(food => !excludedNames.includes(food.name));
  const mains = candidates.filter(food => category(food.name) === 'main');
  const sides = [null, ...candidates.filter(food => category(food.name) === 'side')];
  const drinks = [null, ...candidates.filter(food => category(food.name) === 'drink')];
  const combinations = [];
  for (const main of mains) for (const side of sides) for (const drink of drinks) {
    const items = [main, side, drink].filter(Boolean);
    const totals = Object.fromEntries(
      ['energyKcal', 'protein', 'fat', 'carbohydrate', 'sodium', 'calcium'].map(
        field => [field, items.reduce((sum, food) => sum + food[field], 0)]
      )
    );
    if (totals.energyKcal > budget || totals.energyKcal < budget * 0.65) continue;
    const distance = Math.abs(budget * 0.9 - totals.energyKcal) / Math.max(1, budget);
    const score = preference === 'protein' ? -totals.protein + distance * 10 :
      preference === 'sodium' ? totals.sodium + distance * 100 : distance + totals.sodium / 10000;
    combinations.push({ items, totals, score });
  }
  combinations.sort((a, b) => a.score - b.score || a.totals.energyKcal - b.totals.energyKcal);
  const seen = new Set();
  return combinations.filter(option => {
    const main = option.items[0].name;
    if (seen.has(main)) return false;
    seen.add(main);
    return true;
  }).slice(0, 3);
}
