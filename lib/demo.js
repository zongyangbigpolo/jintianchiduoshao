export function demoNutrition() {
  const food = (name, energyKcal, protein, fat, carbohydrate, sodium, calcium) =>
    ({ name, energyKcal, protein, fat, carbohydrate, sodium, calcium });
  return {
    demo: true,
    source: '离线演示 · 虚构餐品和数据，不是麦当劳菜单',
    fetchedAt: null,
    foods: [
      food('演示鸡肉堡', 410, 24, 18, 38, 800, 90),
      food('演示鱼肉堡', 330, 18, 13, 35, 550, 100),
      food('演示双层牛肉堡', 510, 30, 26, 40, 950, 180),
      food('演示玉米杯', 80, 3, 1, 15, 5, 10),
      food('演示薯条', 210, 3, 9, 28, 150, 13),
      food('演示苹果片', 35, 0, 0, 8, 0, 10),
      food('演示纯牛奶', 130, 7, 7, 10, 75, 230),
      food('演示饮用水', 0, 0, 0, 0, 0, 0)
    ]
  };
}
