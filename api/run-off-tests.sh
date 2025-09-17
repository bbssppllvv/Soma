#!/bin/bash

# OpenFoodFacts Search Testing Suite Runner
# Quick script to run tests and generate analysis

set -e

echo "🚀 OpenFoodFacts Search Testing Suite"
echo "======================================"

# Create results directory with timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RESULTS_DIR="./off-test-results_${TIMESTAMP}"

echo "📁 Results will be saved to: $RESULTS_DIR"

# Run the main test suite
echo ""
echo "🧪 Running search tests..."
node off-search-tester.js --output-dir "$RESULTS_DIR" --verbose

# Check if tests completed successfully
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Tests completed successfully!"
    
    # Run pattern analysis
    echo ""
    echo "🔍 Running pattern analysis..."
    node off-pattern-analyzer.js "$RESULTS_DIR"
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "📊 Analysis completed successfully!"
        echo ""
        echo "📂 Generated files:"
        ls -la "$RESULTS_DIR"
        echo ""
        echo "🔍 Quick summary:"
        echo "  • Raw results: $RESULTS_DIR/raw-results.json"
        echo "  • Summary CSV: $RESULTS_DIR/results-summary.csv"
        echo "  • Performance report: $RESULTS_DIR/performance-report.md"
        echo "  • Pattern analysis: $RESULTS_DIR/pattern-analysis.md"
        echo ""
        echo "💡 View the markdown reports for detailed insights!"
    else
        echo "❌ Pattern analysis failed, but test results are available in $RESULTS_DIR"
    fi
else
    echo "❌ Tests failed!"
    exit 1
fi

echo ""
echo "🎉 All done! Check $RESULTS_DIR for results."
