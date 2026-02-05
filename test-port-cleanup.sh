#!/bin/bash
# Test script to verify port cleanup on new customer journey

echo "🧪 Testing Port Cleanup on New Customer Journey"
echo "================================================"
echo ""

# Function to count active services
count_services() {
    lsof -i :8081-8120 2>/dev/null | grep LISTEN | wc -l
}

# Function to get port details
show_ports() {
    echo "Active ports in range 8081-8120:"
    lsof -i :8081-8120 2>/dev/null | grep LISTEN | awk '{print $1, $2, $9}' | column -t
}

echo "📊 Initial State:"
INITIAL_COUNT=$(count_services)
echo "Active services: $INITIAL_COUNT"
if [ $INITIAL_COUNT -gt 0 ]; then
    show_ports
fi
echo ""

# Start the BizObs server if not running
echo "🔍 Checking if BizObs server is running..."
if ! pgrep -f "node.*server.js" > /dev/null; then
    echo "⚠️  BizObs server not running. Please start it first:"
    echo "   cd '/home/ec2-user/BizObs Generator' && npm start"
    exit 1
fi
echo "✅ BizObs server is running"
echo ""

# Test Journey 1
echo "🚀 Test 1: Creating first customer journey..."
RESPONSE1=$(curl -s -X POST http://localhost:8080/api/journey/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "journey": {
      "companyName": "Test Company A",
      "domain": "test-a.com",
      "industryType": "E-Commerce",
      "steps": [
        {"stepName": "Login", "serviceName": "LoginService"},
        {"stepName": "Browse", "serviceName": "BrowseService"},
        {"stepName": "Checkout", "serviceName": "CheckoutService"}
      ]
    }
  }')

# Wait for services to start
sleep 3

AFTER_JOURNEY1=$(count_services)
echo "Active services after Journey 1: $AFTER_JOURNEY1"
if [ $AFTER_JOURNEY1 -gt 0 ]; then
    show_ports
fi
echo ""

# Test Journey 2 (Different Company)
echo "🚀 Test 2: Creating second customer journey (different company)..."
echo "   This should cleanup services from Journey 1"
RESPONSE2=$(curl -s -X POST http://localhost:8080/api/journey/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "journey": {
      "companyName": "Test Company B",
      "domain": "test-b.com",
      "industryType": "Banking",
      "steps": [
        {"stepName": "Login", "serviceName": "LoginService"},
        {"stepName": "Transfer", "serviceName": "TransferService"},
        {"stepName": "Logout", "serviceName": "LogoutService"}
      ]
    }
  }')

# Wait for cleanup and new services to start
sleep 3

AFTER_JOURNEY2=$(count_services)
echo "Active services after Journey 2: $AFTER_JOURNEY2"
if [ $AFTER_JOURNEY2 -gt 0 ]; then
    show_ports
fi
echo ""

# Analysis
echo "📈 Analysis:"
echo "============"
echo "Initial services:   $INITIAL_COUNT"
echo "After Journey 1:    $AFTER_JOURNEY1"
echo "After Journey 2:    $AFTER_JOURNEY2"
echo ""

# Check if cleanup happened
if [ $AFTER_JOURNEY2 -le $AFTER_JOURNEY1 ]; then
    echo "✅ PORT CLEANUP WORKING: Services were cleaned up between journeys"
    echo "   Expected behavior: Old services stopped before new ones started"
else
    echo "⚠️  PORT CLEANUP MAY NEED REVIEW: Service count increased"
    echo "   Journey 1 services: $AFTER_JOURNEY1"
    echo "   Journey 2 services: $AFTER_JOURNEY2"
fi
echo ""

# Test Journey 3 (Multiple Customers)
echo "🚀 Test 3: Creating multiple customer journeys..."
echo "   This should also cleanup previous services first"
RESPONSE3=$(curl -s -X POST http://localhost:8080/api/journey/simulate-multiple \
  -H "Content-Type: application/json" \
  -d '{
    "customers": 2,
    "journey": {
      "companyName": "Test Company C",
      "domain": "test-c.com",
      "industryType": "Retail",
      "steps": [
        {"stepName": "Landing", "serviceName": "LandingService"},
        {"stepName": "Search", "serviceName": "SearchService"}
      ]
    }
  }')

# Wait for cleanup and new services
sleep 3

AFTER_JOURNEY3=$(count_services)
echo "Active services after Journey 3 (multi-customer): $AFTER_JOURNEY3"
if [ $AFTER_JOURNEY3 -gt 0 ]; then
    show_ports
fi
echo ""

# Final Analysis
echo "📊 Final Analysis:"
echo "=================="
echo "Journey 1 services: $AFTER_JOURNEY1"
echo "Journey 2 services: $AFTER_JOURNEY2"
echo "Journey 3 services: $AFTER_JOURNEY3"
echo ""

if [ $AFTER_JOURNEY3 -le $AFTER_JOURNEY1 ]; then
    echo "✅ CLEANUP VERIFIED: Port cleanup working correctly across all endpoints"
    echo "   ✓ /api/journey/simulate endpoint cleans up ports"
    echo "   ✓ /api/journey/simulate-multiple endpoint cleans up ports"
    echo "   ✓ No port accumulation detected"
else
    echo "⚠️  INVESTIGATION NEEDED: Service count trends upward"
fi
echo ""

# Cleanup test services
echo "🧹 Cleaning up test services..."
echo "Note: Test services will be cleaned up automatically on next journey run"
echo "Or you can manually stop them with: pkill -f 'Service$'"
echo ""
echo "✅ Test complete!"
