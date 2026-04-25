import Anthropic from '@anthropic-ai/sdk';

let _client = null;
function client() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    _client = new Anthropic();
  }
  return _client;
}

const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    cuisine: { type: 'string' },
    prep_time_minutes: { type: 'integer' },
    cook_time_minutes: { type: 'integer' },
    main_ingredients: { type: 'array', items: { type: 'string' } },
    kid_bridge: { type: ['string', 'null'] },
    grocery_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'string' },
          category: {
            type: 'string',
            enum: ['Produce', 'Pantry', 'Refrigerated', 'Frozen', 'Bakery', 'Bulk', 'Other'],
          },
          store: { type: 'string' },
        },
        required: ['name', 'quantity', 'category', 'store'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'name',
    'description',
    'cuisine',
    'prep_time_minutes',
    'cook_time_minutes',
    'main_ingredients',
    'kid_bridge',
    'grocery_items',
  ],
  additionalProperties: false,
};

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    weekly_theme: { type: 'string' },
    meals: {
      type: 'object',
      properties: {
        lunches: { type: 'array', items: MEAL_SCHEMA },
        dinners: { type: 'array', items: MEAL_SCHEMA },
      },
      required: ['lunches', 'dinners'],
      additionalProperties: false,
    },
    staples_called_for: { type: 'array', items: { type: 'string' } },
  },
  required: ['weekly_theme', 'meals', 'staples_called_for'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a meal planner for a small household. Each week you propose exactly 10 lunch ideas and 10 dinner ideas tailored to the household preferences provided.

Hard rules:
- Every meal must conform to the household's dietary requirements (typically vegan; flag gluten when applicable so the household can swap to GF versions).
- Avoid every ingredient listed under hard_dislikes.
- prep_time_minutes + cook_time_minutes must be <= cooking_time_max_minutes.
- Source primary ingredients from the household's primary_stores. Note the most likely store per grocery item.
- INGREDIENT EFFICIENCY IS THE TOP CRAFT GOAL. Plan ingredients so they stretch across multiple meals in the week. A bunch of cilantro should appear in 3+ meals; a block of tofu used in one meal should reappear in another. Surface this strategy in weekly_theme.
- Honor repetition_tolerance_weeks — do not repeat the same dish across recent generations (assume the household has seen the last N weeks of suggestions).

Kid bridge:
- The household has young kids who eat a narrow set of plain foods (see preferences.kids).
- For meals where a simple kid-friendly version is natural, set kid_bridge to a short note (e.g. "set aside plain tofu and steamed broccoli before adding sauce"). Otherwise set kid_bridge to null. Don't force it.

Staples:
- staples_called_for is the deduped list of pantry staples this week's meals depend on (oils, vinegars, spices, soy sauce, common dry goods). Do NOT include fresh produce, proteins, or perishables — those belong in each meal's grocery_items. The user will check off which staples they actually need to buy.

Grocery items per meal:
- Be specific (e.g. "1 lb extra-firm tofu", "2 limes"), not generic ("some tofu").
- Pick category from the supplied enum.
- store: name the primary_store you'd buy this at; if unsure, pick the most likely one.

Output strictly conforms to the JSON schema. The lunches array must contain exactly 10 meals; dinners array must contain exactly 10 meals.`;

function buildPreferencesText(prefs) {
  return `# Household preferences\n\n\`\`\`json\n${JSON.stringify(prefs, null, 2)}\n\`\`\``;
}

function buildWeekRequest({ weekStart, recentMealNames }) {
  const recents = recentMealNames.length
    ? `\n\nMeals seen in the last few weeks (avoid these or close variants):\n${recentMealNames.map((n) => `- ${n}`).join('\n')}`
    : '';
  return `Plan the week starting Monday ${weekStart}. Generate exactly 10 lunches and 10 dinners with the ingredient-stretching plan made explicit in weekly_theme.${recents}`;
}

export async function generateWeek({ preferences, weekStart, recentMealNames = [] }) {
  const stream = client().messages.stream({
    model: 'claude-opus-4-7',
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildPreferencesText(preferences),
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
          { type: 'text', text: buildWeekRequest({ weekStart, recentMealNames }) },
        ],
      },
    ],
  });

  const finalMessage = await stream.finalMessage();
  const textBlock = finalMessage.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text block in response');

  const data = JSON.parse(textBlock.text);
  return {
    data,
    usage: finalMessage.usage,
  };
}
