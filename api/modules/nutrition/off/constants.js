export const REQUIRE_BRAND = String(process.env.OFF_REQUIRE_BRAND || 'false').toLowerCase() === 'true';
export const OFF_BUDGET_MS = Number(process.env.OFF_GLOBAL_BUDGET_MS || 3000);

export const BRAND_ACCEPT_SCORE = 100;
export const BRAND_MISS_PENALTY = 100;

export const SWEET_SENSITIVE_CATEGORIES = new Set(['snack-sweet', 'cookie-biscuit', 'dessert']);

export const SWEET_CATEGORY_TAGS = new Set([
  'en:cookies',
  'en:biscuits',
  'en:desserts',
  'en:snacks-sweet',
  'en:sweet-snacks',
  'en:candies',
  'en:chocolate-products',
  'en:chocolate-biscuits',
  'en:chocolate-covered-biscuits'
]);

export const SWEET_NAME_KEYWORDS = [
  'cookie',
  'biscuit',
  'dessert',
  'snack',
  'brownie',
  'cake',
  'candy',
  'bar',
  'chocolate',
  'wafer'
];

export const FLAVOR_KEYWORDS = [
  'maple',
  'brown sugar',
  'honey',
  'vanilla',
  'chocolate',
  'strawberry',
  'raspberry',
  'cinnamon',
  'protein',
  'flavor',
  'flavoured',
  'flavored',
  'sweetened',
  'caramel',
  'butter',
  'apple'
];

export const PLAIN_ELIGIBLE_CATEGORIES = new Set([
  'grain',
  'porridge',
  'rice',
  'pasta',
  'bread',
  'breakfast-cereal',
  'legume',
  'vegetable',
  'fruit'
]);

export const CATEGORY_POSITIVE_HINTS = {
  porridge: {
    tags: ['en:porridges', 'en:oat-flakes', 'en:breakfast-cereals'],
    keywords: ['porridge', 'oatmeal', 'hot cereal']
  },
  'breakfast-cereal': {
    tags: ['en:breakfast-cereals', 'en:cereals'],
    keywords: ['cereal', 'flakes']
  },
  grain: {
    tags: ['en:grains', 'en:cereal-grains'],
    keywords: ['grain']
  },
  rice: {
    tags: ['en:rices'],
    keywords: ['rice']
  },
  dairy: {
    tags: ['en:milks', 'en:cheeses', 'en:butters', 'en:cream-cheeses'],
    keywords: ['milk', 'leche', 'queso', 'cheese', 'mantequilla', 'butter', 'philadelphia', 'cream cheese']
  }
};
