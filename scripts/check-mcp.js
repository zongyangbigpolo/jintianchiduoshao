import { fetchNutrition } from '../lib/mcp.js';

try {
  const data = await fetchNutrition(process.env.MCD_MCP_TOKEN);
  console.log(JSON.stringify({
    source: data.source,
    fetchedAt: data.fetchedAt,
    uniqueFoods: data.foods.length,
    demo: data.demo,
    sample: data.foods.find(food => food.name === '巨无霸')
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
