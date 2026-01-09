#!/bin/bash
# BizObs LoadRunner Simulation Script with Dynatrace Integration
# Generated: 2026-01-06T14:25:29.327Z
# Following Dynatrace LoadRunner Request Tagging Best Practices

COMPANY_NAME="Argos"
DOMAIN="www.Argos.co.uk"
TEST_ID="30095d40-cc54-45de-9985-18f71d6d5df6"
JOURNEY_INTERVAL=30
DURATION=60
BASE_URL="http://localhost:8080"

# Calculate total journeys for sequential execution
TOTAL_JOURNEYS=$((DURATION / JOURNEY_INTERVAL))

# Dynatrace LoadRunner Integration Variables
LSN="BizObs-Journey-LoadTest"  # Load Script Name
LTN="Argos_Performance_Test_2026-01-06T14-25-29-327Z"  # Load Test Name

echo "🚀 Starting BizObs Sequential Load Simulation for $COMPANY_NAME"
echo "📊 Journey Interval: 30s, Total Duration: 60s"
echo "🎯 Expected Journeys: $TOTAL_JOURNEYS (one every 30s)"
echo "🏷️  Load Test Name: $LTN"
echo "📝 Load Script Name: $LSN"

# Create results directory
RESULTS_DIR="/home/ec2-user/BizObs Generator/loadrunner-tests/Argos_2026-01-06T14-25-29-322Z/results"
mkdir -p "$RESULTS_DIR"

# Demo customer profiles
declare -a CUSTOMER_NAMES=("Sarah Johnson" "Michael Chen" "Emma Rodriguez" "David Kim" "Ashley Thompson" "Robert Martinez" "Jennifer Lee" "Christopher Brown" "Amanda Wilson" "Joshua Garcia" "Melissa Davis" "Andrew Miller" "Jessica Anderson" "Kevin Taylor" "Lauren Thomas" "Brian Jackson")
declare -a CUSTOMER_EMAILS=("sarah.johnson@email.com" "michael.chen@email.com" "emma.rodriguez@email.com" "david.kim@email.com" "ashley.thompson@email.com" "robert.martinez@email.com" "jennifer.lee@email.com" "christopher.brown@email.com" "amanda.wilson@email.com" "joshua.garcia@email.com" "melissa.davis@email.com" "andrew.miller@email.com" "jessica.anderson@email.com" "kevin.taylor@email.com" "lauren.thomas@email.com" "brian.jackson@email.com")
declare -a CUSTOMER_SEGMENTS=("Premium" "Standard" "Budget" "Enterprise" "SMB" "Startup" "Premium" "Standard" "Budget" "Enterprise" "Premium" "Standard" "SMB" "Startup" "Premium" "Standard")
declare -a TRAFFIC_SOURCES=("Google_Ads" "Facebook_Campaign" "Email_Newsletter" "Direct_Traffic" "Referral_Partner" "Organic_Search" "Social_Media" "Content_Marketing")

# Start timestamp
START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION))

# Function to execute a single customer journey
execute_customer_journey() {
    local journey_number=$1
    local log_file="$RESULTS_DIR/journey_$journey_number.log"
    
    # Assign unique customer profile for this journey
    local customer_index=$((journey_number % 16))
    local customer_name="${CUSTOMER_NAMES[$customer_index]}"
    local customer_email="${CUSTOMER_EMAILS[$customer_index]}"
    local customer_segment="${CUSTOMER_SEGMENTS[$customer_index]}"
    local traffic_source="${TRAFFIC_SOURCES[$((RANDOM % 8))]}"
    
    local journey_start=$(date +%s)
    
    echo "$(date): Starting journey $journey_number - Customer: $customer_name ($customer_segment)" >> "$log_file"
    
    # Generate unique correlation ID for this customer journey
    local correlation_id="LR_${LTN}_Journey_${journey_number}_$(date +%s)"
    local customer_id="customer_journey_${journey_number}"
    local session_id="session_${LSN}_journey_${journey_number}"
    local trace_id="trace_${correlation_id}_$(date +%s)"
    
    echo "$(date): Journey $journey_number - Customer: $customer_name - Correlation: $correlation_id" >> "$log_file"
        
        # Execute complete journey using same format as single simulation
        JOURNEY_PAYLOAD=$(cat <<EOF
{
  "journeyId": "$correlation_id",
  "customerId": "$customer_id", 
  "sessionId": "$session_id",
  "traceId": "$trace_id",
  "chained": true,
  "thinkTimeMs": 250,
  "errorSimulationEnabled": true,
  "journey": {
    "journeyId": "$correlation_id",
    "companyName": "Argos",
    "domain": "www.Argos.co.uk",
    "steps": [{"stepIndex":1,"stepName":"ProductDiscovery","serviceName":"ProductDiscoveryService","estimatedDuration":4000,"hasError":false}],
    "additionalFields": {},
    "customerProfile": {
      "name": "$customer_name",
      "email": "$customer_email", 
      "segment": "$customer_segment",
      "userId": "$customer_id",
      "deviceType": "desktop",
      "location": "US-East"
    }
  }
}
EOF
)
        
        # Build X-dynaTrace header with LSN/TSN/LTN (same format as single simulation)
        DYNATRACE_HEADER="TSN=Full_Journey;LSN=BizObs_Argos_www.Argos.co.uk_Journey;LTN=Argos_LoadTest_20260106;VU=$journey_number;SI=CurlSimulation;PC=BizObs-Demo;AN=Argos;CID=$correlation_id"
        
        echo "$(date): Journey $journey_number starting full journey for $customer_name" >> "$log_file"
        
        RESPONSE_TIME_START=$(date +%s%3N)
        HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null \
            -X POST \
            -H "Content-Type: application/json" \
            -H "X-dynaTrace: $DYNATRACE_HEADER" \
            -H "x-correlation-id: $correlation_id" \
            -H "x-customer-id: $customer_id" \
            -H "x-session-id: $session_id" \
            -H "x-trace-id: $trace_id" \
            -H "x-customer-segment: $customer_segment" \
            -H "x-traffic-source: $traffic_source" \
            -H "x-test-iteration: $journey_number" \
            -H "User-Agent: LoadRunner-BizObs-Agent/1.0" \
            -d "$JOURNEY_PAYLOAD" \
            "$BASE_URL/api/journey-simulation/simulate-journey")
        
        RESPONSE_TIME_END=$(date +%s%3N)
        RESPONSE_TIME=$((RESPONSE_TIME_END - RESPONSE_TIME_START))
        
        echo "$(date): Journey $journey_number - Full_Journey - HTTP: $HTTP_CODE - Response Time: ${RESPONSE_TIME}ms - Correlation: $correlation_id" >> "$log_file"
        
    # Send journey completion event
    curl -s -o /dev/null \
        -X POST \
        -H "Content-Type: application/json" \
        -H "X-dynaTrace: TSN=Journey_Completion;LSN=BizObs_Argos_www.Argos.co.uk_Journey;LTN=Argos_LoadTest_20260106;VU=$journey_number;SI=CurlSimulation;PC=BizObs-Demo;AN=Argos;CID=$correlation_id" \
        -H "x-correlation-id: $correlation_id" \
        -d '{
            "eventType": "journey_completed",
            "correlationId": "'$correlation_id'",
            "customerId": "'$customer_id'",
            "companyName": "Argos",
            "customerName": "'$customer_name'",
            "customerSegment": "'$customer_segment'",
            "totalSteps": 1,
            "loadTest": true,
            "completionTime": "'$(date -Iseconds)'"
        }' \
        "$BASE_URL/api/journey-simulation/simulate-journey"
    
    local journey_end=$(date +%s)
    local journey_time=$((journey_end - journey_start))
    echo "$(date): Journey $journey_number completed for $customer_name in ${journey_time}s" >> "$log_file"
}

# Execute sequential customer journeys
journey_number=1
echo "$(date): Starting sequential load simulation..."

while [ $(date +%s) -lt $END_TIME ] && [ $journey_number -le $TOTAL_JOURNEYS ]; do
    echo "$(date): Executing customer journey $journey_number of $TOTAL_JOURNEYS"
    
    # Execute journey in background to allow for next journey scheduling
    execute_customer_journey $journey_number &
    journey_pid=$!
    
    # Increment journey counter
    journey_number=$((journey_number + 1))
    
    # Wait for journey interval before starting next journey
    if [ $journey_number -le $TOTAL_JOURNEYS ] && [ $(date +%s) -lt $END_TIME ]; then
        echo "$(date): Waiting 30s before next journey..."
        sleep $JOURNEY_INTERVAL
    fi
done

# Wait for any remaining journeys to complete
echo "$(date): Waiting for remaining journeys to complete..."
wait

echo "🏁 Sequential load test completed. Results in: $RESULTS_DIR"
echo "📊 Total journeys executed: $((journey_number - 1))"

# Generate summary report
echo "📊 Generating test summary..."
cat > "$RESULTS_DIR/test_summary.html" << EOF
<!DOCTYPE html>
<html>
<head>
    <title>BizObs LoadRunner Test Results - $COMPANY_NAME</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f0f0f0; padding: 15px; border-radius: 5px; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
        .metric { background: #fff; border: 1px solid #ddd; padding: 15px; border-radius: 5px; text-align: center; }
        .metric h3 { margin: 0 0 10px 0; color: #333; }
        .metric .value { font-size: 24px; font-weight: bold; color: #007acc; }
        .logs { background: #f9f9f9; padding: 15px; border-radius: 5px; max-height: 400px; overflow-y: auto; }
    </style>
</head>
<body>
    <div class="header">
        <h1>BizObs LoadRunner Test Results</h1>
        <p><strong>Company:</strong> $COMPANY_NAME</p>
        <p><strong>Domain:</strong> $DOMAIN</p>
        <p><strong>Test ID:</strong> $TEST_ID</p>
        <p><strong>Duration:</strong> 60 seconds</p>
        <p><strong>Virtual Users:</strong> $VIRTUAL_USERS</p>
        <p><strong>Generated:</strong> $(date)</p>
    </div>
    
    <div class="metrics">
        <div class="metric">
            <h3>Total Requests</h3>
            <div class="value">$(grep -h "executing" $RESULTS_DIR/user_*.log | wc -l)</div>
        </div>
        <div class="metric">
            <h3>Successful Requests</h3>
            <div class="value">$(grep -h "HTTP: 200" $RESULTS_DIR/user_*.log | wc -l)</div>
        </div>
        <div class="metric">
            <h3>Failed Requests</h3>
            <div class="value">$(grep -hv "HTTP: 200" $RESULTS_DIR/user_*.log | grep "HTTP:" | wc -l)</div>
        </div>
        <div class="metric">
            <h3>Journey Steps</h3>
            <div class="value">1</div>
        </div>
    </div>
    
    <h2>Test Execution Logs</h2>
    <div class="logs">
        <pre>$(head -100 $RESULTS_DIR/user_*.log)</pre>
    </div>
    
    <h2>Dynatrace Analysis</h2>
    <p>Filter your Dynatrace analysis using:</p>
    <ul>
        <li><strong>Test Name:</strong> $TEST_ID</li>
        <li><strong>Service:</strong> bizobs-main-server</li>
        <li><strong>Request Attribute:</strong> x-dynatrace-test contains "BizObs-Journey-Test"</li>
    </ul>
</body>
</html>
EOF

echo "✅ Test summary generated: $RESULTS_DIR/test_summary.html"
