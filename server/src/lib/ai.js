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

const RECIPE_SYSTEM_PROMPT = `You write tight, practical home recipes for a household with strict dietary requirements. Output Markdown only. No preamble, no closing remarks.

Structure each recipe exactly like this:

## Ingredients
- 1 lb extra-firm tofu, pressed and cubed
- 2 limes (zest + juice)
- (...one per line, with quantities, grouped logically but no subheadings)

## Steps
1. First step in one sentence, imperative voice.
2. Second step.
3. (...numbered, 6–10 steps total, each one a complete action a tired weeknight cook can scan in 2 seconds.)

## Notes
- Optional. Only include if there's something genuinely useful: a swap that saves time, a kid-bridge hand-off point, a common pitfall.

Hard rules:
- Every ingredient and step must respect the household's dietary requirements (this household is vegan; the husband prefers gluten-free, so call out which ingredient needs to be GF when applicable — e.g. "gluten-free tamari" or "tamari (use coconut aminos for strict GF)").
- Total active time must be realistic for the prep_minutes + cook_minutes window on the meal card. If the user's preferences cap weeknight cook time, respect it.
- Avoid every ingredient in hard_dislikes.
- If the meal card has a kid_bridge note, include a Notes line showing exactly where to set aside plain components for the kids.
- Do not invent ingredients beyond what the meal card lists, unless they are pantry staples the household clearly already has (salt, pepper, neutral oil, garlic, common spices). Don't add fresh produce or proteins not already implied by the meal.`;

export async function generateRecipe({ meal, preferences }) {
  const mealCard = {
    name: meal.name,
    description: meal.description,
    cuisine: meal.cuisine,
    prep_time_minutes: meal.prep_minutes,
    cook_time_minutes: meal.cook_minutes,
    main_ingredients: JSON.parse(meal.main_ingredients_json || '[]'),
    grocery_items: JSON.parse(meal.grocery_items_json || '[]'),
    kid_bridge: meal.kid_bridge || null,
  };

  const response = await client().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: RECIPE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildPreferencesText(preferences),
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
          {
            type: 'text',
            text: `Write the full recipe for this meal:\n\n\`\`\`json\n${JSON.stringify(mealCard, null, 2)}\n\`\`\``,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text block in recipe response');
  return { markdown: textBlock.text.trim(), usage: response.usage };
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
