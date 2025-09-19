#!/bin/bash

# Тест кейса Feastables с Brand Gate v2 и Category Guard

echo "🍫 Тестирование кейса Feastables Cookies & Creme"
echo "==============================================="
echo ""

# Проверяем наличие Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js не найден. Пожалуйста, установите Node.js для запуска теста."
    exit 1
fi

echo "✅ Node.js найден: $(node --version)"
echo ""

# Переходим в директорию API
cd "$(dirname "$0")"

echo "🎯 Что тестируем:"
echo "=================="
echo "1. 🚫 Brand Gate v2"
echo "   • Строгая фильтрация при известном бренде (Mr Beast/Feastables)"
echo "   • Поддержка синонимов брендов (mrbeast, feastables)"
echo "   • Salvage брендов из product_name при пустых brands_tags"
echo ""
echo "2. 🏷️ Category Guard"  
echo "   • Предотвращение выбора мороженого вместо шоколада"
echo "   • Категорийные бонусы/штрафы (snack-sweet vs ice-cream)"
echo "   • Hard blocking конфликтующих категорий при известном бренде"
echo ""
echo "3. 🔒 Контролируемые brandless fallback'и"
echo "   • Безбрендовые поиски только после исчерпания брендовых"
echo "   • Brand Gate v2 применяется даже в split-OR запросах"
echo ""
echo "⚠️  Ожидаемый результат:"
echo "   ✅ НЕ должен выбрать мороженое Cookies & Cream (7613312361887)"
echo "   ✅ Должен найти продукты бренда Feastables/Mr Beast"
echo "   ✅ Приоритет категории snack-sweet (шоколад) над ice-cream"
echo ""

# Запускаем тест с включенными gate'ами
OFF_USE_SMART_ROUTING=true \
OFF_ENFORCE_BRAND_GATE_V2=true \
OFF_CATEGORY_HARD_BLOCKS_ENABLED=true \
node test-feastables-case.js

# Проверяем результат
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Тестирование кейса Feastables завершено!"
    echo ""
    echo "📊 Ключевые индикаторы успеха:"
    echo "   • Отсутствие мороженого в топ-5 результатов"
    echo "   • Присутствие продуктов бренда Feastables/Mr Beast"
    echo "   • Логи [BRAND_GATE_V2] и [CATEGORY_GUARD]"
    echo "   • Метрики brand_gate_blocked и category_conflict_blocked"
else
    echo ""
    echo "❌ Тестирование завершилось с ошибкой"
    exit 1
fi
