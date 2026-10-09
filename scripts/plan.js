import { fetchNutrition } from '../lib/mcp.js';
import { demoNutrition } from '../lib/demo.js';
import { estimate, recommend } from '../public/planner.js';

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 16_384) throw new Error('输入过大，请仅提供本次搭配所需的信息。');
  }
  const { profile, preference = 'balanced', excludedNames = [] } = JSON.parse(input);
  if (!Array.isArray(excludedNames) || excludedNames.some(name => typeof name !== 'string')) {
    throw new Error('excludedNames 必须是餐品名称字符串数组。');
  }
  const stats = estimate(profile);
  const nutrition = process.argv.includes('--demo') ? demoNutrition() :
    await fetchNutrition(process.env.MCD_MCP_TOKEN);
  console.log(JSON.stringify({
    source: nutrition.source,
    fetchedAt: nutrition.fetchedAt,
    demo: nutrition.demo,
    estimate: stats,
    meals: recommend(nutrition.foods, stats.budget, preference, excludedNames),
    disclaimer: '仅为一餐信息参考，不是医疗或营养处方，不保证门店供应和价格；无匹配组合不代表应跳餐。'
  }, null, 2));
} catch (error) {
  console.error(error instanceof SyntaxError ? '请输入合法 JSON。' : error.message);
  process.exitCode = 1;
}
