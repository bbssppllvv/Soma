#!/bin/bash

# Pipeline Improvements Test Runner
# Tests the new features: Rescue Queries, Split-OR, Attribute Handling

echo "🚀 Starting Pipeline Improvements Tests..."
echo "=========================================="

# Check if we're in the right directory
if [ ! -f "test-pipeline-improvements.js" ]; then
    echo "❌ Error: test-pipeline-improvements.js not found"
    echo "Please run this script from the api/ directory"
    exit 1
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js not found"
    echo "Please install Node.js to run the tests"
    exit 1
fi

# Set environment variables for testing
export OFF_ENABLED=true
export OFF_SEARCH_MAX_PAGES=5
export OFF_RESCUE_EXTRA_PAGES=3
export OFF_NEGATIVE_TOKEN_PENALTY=4
export OFF_BRAND_PAGE_SIZE=40
export OFF_FALLBACK_PAGE_SIZE=20
export OFF_TIMEOUT_MS=10000

echo "Environment configured:"
echo "  OFF_ENABLED=$OFF_ENABLED"
echo "  OFF_SEARCH_MAX_PAGES=$OFF_SEARCH_MAX_PAGES"
echo "  OFF_RESCUE_EXTRA_PAGES=$OFF_RESCUE_EXTRA_PAGES"
echo ""

# Run the tests
echo "Running integration tests..."
node test-pipeline-improvements.js

# Capture exit code
TEST_EXIT_CODE=$?

echo ""
echo "=========================================="
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo "🎉 All tests passed!"
    echo "✅ Rescue Queries implemented"
    echo "✅ Split-OR retry implemented" 
    echo "✅ Attribute handling implemented"
else
    echo "❌ Some tests failed (exit code: $TEST_EXIT_CODE)"
    echo "Check the logs above for details"
fi

exit $TEST_EXIT_CODE
