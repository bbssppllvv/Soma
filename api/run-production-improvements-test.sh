#!/bin/bash

# Скрипт для тестирования улучшений продакшена

echo "🚀 Тестирование улучшений для продакшена"
echo "========================================"
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
echo "1. 🌐 Locale-safe запросы без смешения языков"
echo "   • CGI-first с точными фразами из off_primary_tokens"
echo "   • Исключение смешанных запросов (cream montada)"
echo ""
echo "2. 🚫 Жёсткий атрибутный gate"
echo "   • Фаза А: только 'чистые' кандидаты (без avoided атрибутов)"
echo "   • Фаза B: 'грязные' кандидаты с пониженной уверенностью"
echo "   • Снижение бренд-бустов для избежания light/zero/spray"
echo ""
echo "3. ✨ Clean-first выбор"
echo "   • Приоритет brandMatch + no-avoid кандидатов"
echo "   • Целевой rescue перед деградацией"
echo "   • Контролируемый no_candidates вместо 'грязного' выбора"
echo ""
echo "⏱️  Примерное время выполнения: ~45 секунд"
echo ""

# Запускаем тест с включенными улучшениями
OFF_USE_SMART_ROUTING=true node test-production-improvements.js

# Проверяем результат
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Тестирование улучшений завершено успешно!"
    echo ""
    echo "📊 Ключевые метрики для анализа:"
    echo "   • Success@1 rate - должен быть >50% для локальных брендов"
    echo "   • Clean phase usage - должен быть >80%"
    echo "   • Degraded selections - должно быть <20%"
    echo "   • API routing accuracy - должна быть 100%"
    echo ""
    echo "🎯 Следующие шаги:"
    echo "   • Анализировать метрики качества"
    echo "   • Настроить пороги под реальную нагрузку"
    echo "   • Активировать в продакшене с мониторингом"
else
    echo ""
    echo "❌ Тестирование завершилось с ошибкой"
    exit 1
fi
