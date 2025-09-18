#!/bin/bash

# Скрипт для запуска сравнительного тестирования SAL vs CGI API
# OpenFoodFacts API Comparison Test

echo "🔍 SAL vs CGI API Comparison Test"
echo "=================================="
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

# Проверяем наличие скрипта сравнения
if [ ! -f "sal-vs-cgi-comparison.js" ]; then
    echo "❌ Файл sal-vs-cgi-comparison.js не найден в текущей директории."
    exit 1
fi

echo "🚀 Запускаем сравнительное тестирование..."
echo "📋 Будет протестировано 9 продуктов:"
echo "   • Central Lechera Asturiana (3 варианта)"
echo "   • Coca-Cola Zero (2 варианта)" 
echo "   • Pepsi Max Cherry"
echo "   • Ben & Jerry's Chocolate Fudge Brownie"
echo "   • Nutella"
echo "   • H-E-B Red Kidney Beans"
echo ""
echo "⏱️  Примерное время выполнения: ~30 секунд"
echo ""

# Запускаем тест
node sal-vs-cgi-comparison.js

# Проверяем результат
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Тестирование завершено успешно!"
    echo ""
    echo "📄 Результаты сохранены в JSON файл с временной меткой"
    echo "🔍 Проверьте файлы sal-vs-cgi-results_*.json для детального анализа"
else
    echo ""
    echo "❌ Тестирование завершилось с ошибкой"
    exit 1
fi
