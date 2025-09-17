# 🍎 Nutrition API Integration Plan

## 🎯 Goal
Prepare the system for integrating third-party nutrition APIs (USDA FoodData Central, Edamam, Spoonacular) to deliver precise nutritional analysis based on standardized product data.

## 📊 Current System (AI-based)

### ✅ What we already have
- GPT-5 analysis for photos and text
- Calorie, macro, and fiber estimates
- Personalized advice based on goals
- **New**: Standardized food names
- **New**: Portion estimates in grams and visual descriptors
- **New**: User-friendly portion descriptions

### 🔄 Current analysis flow
```
1. User → photo/text
2. AI → analysis + food name + portion estimate
3. Output → "Grilled Chicken Breast, 150 g (palm-sized)"
4. Persist → database with full context
```

## 🚀 Future System (API + AI hybrid)

### 📋 Integration phases

#### **Phase 1: Data preparation** ✅ Completed
- [x] Standardized food names
- [x] Portion sizes in grams
- [x] Visual portion descriptors
- [x] Updated database schema

#### **Phase 2: API integration** (next)
- [ ] Integrate USDA FoodData Central API
- [ ] Build product lookup by name
- [ ] Map AI food names to API products
- [ ] Cache external product data

#### **Phase 3: Hybrid workflow** (later)
- [ ] AI determines product + portion
- [ ] API returns authoritative nutrition facts
- [ ] Combine AI + API data for the final response

## 🗄️ Database Structure

### 📋 Current columns in `entries`
- Core nutrition fields (existing)
- **New** portion columns: `food_name`, `portion_size`, `portion_description`

### 🔮 Future tables
- Standardized products (API metadata)
- AI↔API mapping table

## 🧪 Testing scenarios
- Text: "chicken breast 150g + rice 200g + olive oil 10ml"
- Photo: pasta with sauce
- Item with `unit="piece"`

## 📈 Metrics to monitor
- Coverage@0.7 (share of successful resolutions)
- P50 latency < 2–3 s
- Ask-rate (needs_clarification frequency)
- Calibration check: oil calories ≈ 90–92 kcal/10 ml

## 🔧 Rollout checklist
1. Enable `OFF_ENABLED=true` with `OFF_ENABLED_PERCENT=10`
2. Monitor logs for coverage, latency, errors
3. Gradually increase traffic to 25%, 50%, 100%

## 📌 Follow-up tasks
- Build canonical ingredient database
- Implement hybrid AI+API scoring
- Add regression tests for staple foods
