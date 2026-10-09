import { decode } from '@toon-format/toon';

const fields = ['energyKcal', 'protein', 'fat', 'carbohydrate', 'sodium', 'calcium'];

export function parseNutrition(result) {
  if (result.isError) throw new Error('麦当劳营养工具返回错误，请稍后重试。');
  let payload = result.structuredContent;
  if (!payload) {
    const text = result.content?.find(part => part.type === 'text')?.text;
    if (!text) throw new Error('营养工具未返回可识别的数据。');
    const marker = '## Original Response';
    const json = text.includes(marker) ? text.slice(text.indexOf(marker) + marker.length).trim() : text;
    try {
      payload = JSON.parse(json);
    } catch {
      throw new Error('营养工具响应格式已变化，无法解析。');
    }
  }
  if (payload.success === false || payload.code !== 200 || typeof payload.data !== 'string') {
    throw new Error('官方营养接口未成功返回数据，请稍后重试。');
  }
  let rows;
  try {
    rows = decode(payload.data);
  } catch {
    throw new Error('官方营养表格式已变化，无法解析 TOON 数据。');
  }
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('官方营养表为空或格式不正确。');
  const foods = new Map();
  for (const row of rows) {
    if (!row || typeof row.productName !== 'string' || !row.productName.trim() ||
        fields.some(key => typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0)) {
      throw new Error('官方营养表包含缺失或无效数据；已停止推荐，未将缺失值当作零。');
    }
    const food = { name: row.productName.trim() };
    for (const field of fields) food[field] = row[field];
    const previous = foods.get(food.name);
    if (previous && fields.some(field => previous[field] !== food[field])) {
      throw new Error('官方营养表存在同名不同营养值，需确认份量后才能推荐。');
    }
    foods.set(food.name, food);
  }
  return [...foods.values()];
}
