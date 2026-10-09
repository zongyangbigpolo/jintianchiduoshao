import { estimate, recommend, TRAINING } from './planner.js';

const $ = selector => document.querySelector(selector);
let nutrition;
const excluded = new Set();

function el(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderFoods() {
  const query = $('#search').value.trim();
  const rows = (nutrition?.foods ?? []).filter(food => food.name.includes(query)).map(food => {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = excluded.has(food.name);
    checkbox.setAttribute('aria-label', `排除${food.name}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) excluded.add(food.name);
      else excluded.delete(food.name);
      $('#result').hidden = true;
      $('#empty').hidden = false;
    });
    cell.append(checkbox);
    row.append(cell, el('td', food.name));
    for (const key of ['energyKcal', 'protein', 'fat', 'carbohydrate', 'sodium']) row.append(el('td', food[key]));
    return row;
  });
  $('#foods').replaceChildren(...rows);
  if (!rows.length) {
    const row = document.createElement('tr');
    const cell = el('td', nutrition ? '没有匹配餐品。' : '营养数据尚未就绪。');
    cell.colSpan = 7;
    row.append(cell);
    $('#foods').append(row);
  }
}

async function load() {
  nutrition = undefined;
  $('#submit').disabled = true;
  $('#reload').disabled = true;
  $('#result').hidden = true;
  $('#empty').hidden = false;
  $('#source').textContent = '正在获取营养数据…';
  renderFoods();
  try {
    const response = await fetch('/api/nutrition', { signal: AbortSignal.timeout(40_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '获取营养数据失败。');
    nutrition = data;
    $('#source').textContent = `${data.demo ? '演示模式 · ' : '已连接 · '}${data.source} · ${data.foods.length} 款${data.fetchedAt ? ` · 获取于 ${new Date(data.fetchedAt).toLocaleString('zh-CN')}` : ''}`;
    $('.data-status').classList.toggle('demo', data.demo);
    $('#submit').disabled = false;
    renderFoods();
  } catch (error) {
    $('#source').textContent = error.name === 'TimeoutError' ? '连接超时，请检查网络后重新获取。' : error.message;
  } finally {
    $('#reload').disabled = false;
  }
}

$('#training').addEventListener('change', () => {
  const rest = $('#training').value === 'rest';
  $('#minutes').disabled = rest;
  $('#minutes').value = rest ? '0' : '45';
  $('#minutes').min = rest ? '0' : '1';
});
$('#profile').addEventListener('input', () => {
  $('#result').hidden = true;
  $('#empty').hidden = false;
  $('#form-error').hidden = true;
});
$('#profile').addEventListener('submit', event => {
  event.preventDefault();
  $('#form-error').hidden = true;
  try {
    if (!nutrition) throw new Error('请先获取营养数据。');
    const form = new FormData(event.currentTarget);
    const profile = Object.fromEntries(form);
    for (const name of ['height', 'weight', 'age', 'minutes', 'eaten', 'share']) profile[name] = Number(form.get(name));
    profile.adultGeneralHealth = form.has('adultGeneralHealth');
    const stats = estimate(profile);
    const options = recommend(nutrition.foods, stats.budget, profile.preference, [...excluded]);
    $('#budget').textContent = stats.budget;
    $('#result-mode').textContent = nutrition.demo ? '虚构数据演示' : '官方营养数据';
    $('#metrics').replaceChildren(...[
      ['体脂粗估区间', `${stats.bodyFat.join('–')}%`],
      ['计划训练净消耗', `${stats.exerciseRange.join('–')} kcal`],
      ['全天维持参考', `${stats.daily} kcal`],
      ['今日剩余参考', `${stats.remaining} kcal`]
    ].map(([label, value]) => {
      const card = el('div', '', 'metric');
      card.append(el('span', label), el('strong', value));
      return card;
    }));
    $('#estimate-note').textContent = stats.warning;
    const cards = options.map((option, index) => {
      const card = el('article', '', 'meal-card');
      const heading = el('div', '', 'meal-title');
      heading.append(el('span', `搭配 0${index + 1}`, 'meal-number'), el('strong', `${option.totals.energyKcal} kcal`));
      card.append(heading);
      const list = document.createElement('ul');
      option.items.forEach(item => list.append(el('li', `${item.name} × 1 份 · ${item.energyKcal} kcal`)));
      card.append(list, el('p', `蛋白质 ${option.totals.protein} g　脂肪 ${option.totals.fat} g　碳水 ${option.totals.carbohydrate} g　钠 ${option.totals.sodium} mg`, 'macros'));
      if (option.totals.sodium > 800) card.append(el('p', '本组合钠较多，请结合全天饮食留意摄入。', 'sodium-note'));
      return card;
    });
    $('#meals').replaceChildren(...cards);
    if (!cards.length) $('#meals').append(el('p', '没有找到符合当前范围的完整组合。这不代表你不该吃饭；可核对已摄入估算、调整本餐份额或直接查看营养表。不建议为了匹配结果增加训练。', 'notice'));
    $('#calculation').replaceChildren(...[
      `BMI = 体重 ÷ 身高² = ${stats.bmi}。基础体脂估计采用 Deurenberg 成人公式（1.2 × BMI + 0.23 × 年龄 − 10.8 × 性别系数 − 5.4；男=1，女=0）。`,
      '显示范围取“公式估计 ±5 个百分点”和身材描述宽范围的并集，再限定在 5–55%。偏瘦 8–23%、匀称 15–32%、微胖 23–40% 仅为展示不确定性的产品假设，不是医学界限或经验证的分类器。肌肉量较高者可能偏差很大。',
      `体脂粗估不足以可靠推算瘦体重，因此热量独立使用 Mifflin–St Jeor：10 × kg + 6.25 × cm − 5 × 年龄 + 性别常数（男 +5、女 −161）。基础代谢约 ${stats.bmr} kcal，乘日常活动系数后约 ${stats.baseline} kcal。`,
      `${TRAINING[profile.training].name}：MET ${TRAINING[profile.training].met}。净训练消耗 = (MET − 1) × 3.5 × kg ÷ 200 × 分钟，约 ${stats.exercise} kcal；展示 ±30% 是敏感性范围，不是统计置信区间。减去 1 MET 避免重复计算静息消耗。`,
      `全天参考 = 日常消耗 + 计划训练净消耗；本餐 = min(全天 × ${Math.round(profile.share * 100)}%, max(0, 全天 − 已摄入))，向下取整。没有自动减脂缺口，也没有将训练消耗重复加到本餐。`,
      '在参考上限的 65–100% 范围内搜索组合；每类至多一份，按偏好排序并优先展示不同主食。分类通过餐品名称规则识别，未识别品项仍展示在营养表中。组合不是官方套餐，也不代表门店在售。'
    ].map(text => el('p', text)));
    $('#empty').hidden = true;
    $('#result').hidden = false;
  } catch (error) {
    $('#result').hidden = true;
    $('#empty').hidden = false;
    $('#form-error').textContent = error.message;
    $('#form-error').hidden = false;
  }
});
$('#reload').addEventListener('click', load);
$('#search').addEventListener('input', renderFoods);
load();
