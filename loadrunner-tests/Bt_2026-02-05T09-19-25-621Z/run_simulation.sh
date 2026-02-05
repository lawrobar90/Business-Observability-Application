#!/bin/bash
# BizObs LoadRunner Simulation Script with Dynatrace Integration
# Generated: 2026-02-05T09:19:25.628Z
# Following Dynatrace LoadRunner Request Tagging Best Practices

COMPANY_NAME="Bt"
DOMAIN="www.bt.com"
TEST_ID="3fc0718d-1208-4e0c-a5c9-86df1c4ade6b"
JOURNEY_INTERVAL=30
DURATION=300
BASE_URL="http://localhost:8080"

# Calculate total journeys for sequential execution
TOTAL_JOURNEYS=$((DURATION / JOURNEY_INTERVAL))

# Dynatrace LoadRunner Integration Variables
LSN="BizObs-Journey-LoadTest"  # Load Script Name
LTN="Bt_Performance_Test_2026-02-05T09-19-25-628Z"  # Load Test Name

echo "🚀 Starting BizObs Sequential Load Simulation for $COMPANY_NAME"
echo "📊 Journey Interval: 30s, Total Duration: 300s"
echo "🎯 Expected Journeys: $TOTAL_JOURNEYS (one every 30s)"
echo "🏷️  Load Test Name: $LTN"
echo "📝 Load Script Name: $LSN"

# Create results directory
RESULTS_DIR="/home/ec2-user/BizObs Generator/loadrunner-tests/Bt_2026-02-05T09-19-25-621Z/results"
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
  "errorSimulationEnabled": false,
  "journey": {
    "journeyId": "$correlation_id",
    "companyName": "Bt",
    "domain": "www.bt.com",
    "steps": [{"stepIndex":1,"stepName":"ComparisonClickthrough","serviceName":"ComparisonClickthroughService","description":"User arrives from a comparison site (e.g. Uswitch) and clicks through to a BT Full Fibre product such as BTFF500. Generates measurable events: campaign_click, referral_source_identified, product_impression.","category":"Acquisition","timestamp":"2025-11-21T00:00:00.000Z","estimatedDuration":2,"businessRationale":"Comparison‑site visitors typically spend 1–3 minutes evaluating offers before clicking through. This step directly affects paid media ROI and partner referral economics.","substeps":[{"substepName":"ReferralLandingPageView","duration":1},{"substepName":"ProductClickthrough","duration":1}],"hasError":false},{"stepIndex":2,"stepName":"PlanSelection","serviceName":"PlanSelectionService","description":"User compares BT broadband plans (BTFF500, BTFF900) and selects a preferred speed tier. Generates events: product_view, plan_compare, plan_selected.","category":"Consideration","estimatedDuration":4,"businessRationale":"Telecom customers typically spend 3–5 minutes comparing speed tiers and contract terms. This step heavily influences conversion and ARPU mix.","substeps":[{"substepName":"PlanGridLoad","duration":2},{"substepName":"PlanEvaluationAndSelection","duration":2}],"hasError":false},{"stepIndex":3,"stepName":"IdentityVerification","serviceName":"IdentityVerificationService","description":"User logs in or creates a BT ID, completes email/SMS verification. Generates events: login_success, account_created, identity_verified.","category":"Authentication","estimatedDuration":3,"businessRationale":"Identity verification in telecom typically takes 2–4 minutes. This step is essential for linking orders to customer profiles and enabling CLV attribution.","substeps":[{"substepName":"LoginOrRegistration","duration":1},{"substepName":"OTPVerification","duration":2}],"hasError":false},{"stepIndex":4,"stepName":"BasketReview","serviceName":"BasketReviewService","description":"User reviews selected plan, evaluates add-ons (e.g. Complete Wi-Fi), and confirms basket contents. Generates events: basket_viewed, add_on_added, basket_value_updated.","category":"Basket","estimatedDuration":3,"businessRationale":"A 2–4 minute basket review is typical in telecom as customers validate pricing and optional add-ons. This step drives margin expansion and AOV.","substeps":[{"substepName":"BasketSummaryLoad","duration":1},{"substepName":"AddOnReviewAndConfirmation","duration":2}],"hasError":false},{"stepIndex":5,"stepName":"CheckoutPayment","serviceName":"CheckoutPaymentService","description":"User enters billing details, sets up Direct Debit, and authorises payment. Generates events: checkout_started, payment_method_added, payment_authorised, checkout_completed.","category":"Payment","estimatedDuration":5,"businessRationale":"Telecom checkout flows with Direct Debit setup typically take 4–6 minutes. This is the highest revenue‑risk step; any latency or errors directly reduce daily booked revenue.","substeps":[{"substepName":"BillingDetailsEntry","duration":2},{"substepName":"DirectDebitSetupAndPayment","duration":3}],"hasError":false},{"stepIndex":6,"stepName":"OrderConfirmationProvisioning","serviceName":"OrderConfirmationProvisioningService","description":"User receives order confirmation, contract summary, and activation date. Generates events: order_confirmed, contract_value_recorded, provisioning_request_created.","category":"Fulfilment","estimatedDuration":2,"businessRationale":"Confirmation and provisioning initiation typically take 1–3 minutes. This step finalises revenue attribution and triggers operational fulfilment workflows.","substeps":[{"substepName":"OrderConfirmationView","duration":1},{"substepName":"ProvisioningRequestInitiated","duration":1}],"hasError":false}],
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
        DYNATRACE_HEADER="TSN=Full_Journey;LSN=BizObs_Bt_www.bt.com_Journey;LTN=Bt_LoadTest_20260205;VU=$journey_number;SI=CurlSimulation;PC=BizObs-Demo;AN=Bt;CID=$correlation_id"
        
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
        -H "X-dynaTrace: TSN=Journey_Completion;LSN=BizObs_Bt_www.bt.com_Journey;LTN=Bt_LoadTest_20260205;VU=$journey_number;SI=CurlSimulation;PC=BizObs-Demo;AN=Bt;CID=$correlation_id" \
        -H "x-correlation-id: $correlation_id" \
        -d '{
            "eventType": "journey_completed",
            "correlationId": "'$correlation_id'",
            "customerId": "'$customer_id'",
            "companyName": "Bt",
            "customerName": "'$customer_name'",
            "customerSegment": "'$customer_segment'",
            "totalSteps": 6,
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

echo "🏁 Sequential load test completed. Results in: "$RESULTS_DIR""
echo "📊 Total journeys executed: $((journey_number - 1))"

# Generate summary report
echo "📊 Generating test summary..."
cat > ""$RESULTS_DIR/test_summary.html"" << EOF
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
        <p><strong>Duration:</strong> 300 seconds</p>
        <p><strong>Virtual Users:</strong> $VIRTUAL_USERS</p>
        <p><strong>Generated:</strong> $(date)</p>
    </div>
    
    <div class="metrics">
        <div class="metric">
            <h3>Total Requests</h3>
            <div class="value">$(find ""$RESULTS_DIR"" -name "journey_*.log" -exec grep -h "executing" {} ; 2>/dev/null | wc -l)</div>
        </div>
        <div class="metric">
            <h3>Successful Requests</h3>
            <div class="value">$(find ""$RESULTS_DIR"" -name "journey_*.log" -exec grep -h "HTTP: 200" {} ; 2>/dev/null | wc -l)</div>
        </div>
        <div class="metric">
            <h3>Failed Requests</h3>
            <div class="value">$(find ""$RESULTS_DIR"" -name "journey_*.log" -exec grep -hv "HTTP: 200" {} ; 2>/dev/null | grep "HTTP:" | wc -l)</div>
        </div>
        <div class="metric">
            <h3>Journey Steps</h3>
            <div class="value">6</div>
        </div>
    </div>
    
    <h2>Test Execution Logs</h2>
    <div class="logs">
        <pre>$(find ""$RESULTS_DIR"" -name "journey_*.log" -exec head -50 {} ; 2>/dev/null | head -100)</pre>
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

echo "✅ Test summary generated: "$RESULTS_DIR/test_summary.html""
