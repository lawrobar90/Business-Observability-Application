/*
 * LoadRunner Script Generated from BizObs Journey Configuration
 * Company: Bt
 * Domain: www.bt.com
 * Generated: 2026-02-05T09:19:25.623Z
 * Test ID: 9dd6d415-2cf0-4ee8-b622-0a1410318496
 * 
 * Dynatrace LoadRunner Integration with Request Tagging
 * LSN: BizObs_Bt_www.bt.com_Journey (Load Script Name)
 * TSN: Dynamic per step (Test Step Names)
 * LTN: Bt_LoadTest_20260205 (Load Test Name)
 */

#include "web_api.h"
#include "lrun.h"

// Global Dynatrace integration variables
char dt_test_header[1024];
char correlation_id[64];
char customer_id[64];
char session_id[64];
char trace_id[64];
char correlation_id[64];
char customer_id[64];
char session_id[64];
char trace_id[64];

// Demo customer profiles for realistic simulation
char* customer_names[] = {
    "Sarah Johnson", "Michael Chen", "Emma Rodriguez", "David Kim", 
    "Ashley Thompson", "Robert Martinez", "Jennifer Lee", "Christopher Brown",
    "Amanda Wilson", "Joshua Garcia", "Melissa Davis", "Andrew Miller",
    "Jessica Anderson", "Kevin Taylor", "Lauren Thomas", "Brian Jackson"
};

char* customer_emails[] = {
    "sarah.johnson@email.com", "michael.chen@email.com", "emma.rodriguez@email.com",
    "david.kim@email.com", "ashley.thompson@email.com", "robert.martinez@email.com",
    "jennifer.lee@email.com", "christopher.brown@email.com", "amanda.wilson@email.com",
    "joshua.garcia@email.com", "melissa.davis@email.com", "andrew.miller@email.com",
    "jessica.anderson@email.com", "kevin.taylor@email.com", "lauren.thomas@email.com",
    "brian.jackson@email.com"
};

char* customer_segments[] = {
    "Premium", "Standard", "Budget", "Enterprise", "SMB", "Startup"
};

char* traffic_sources[] = {
    "Google_Ads", "Facebook_Campaign", "Email_Newsletter", "Direct_Traffic",
    "Referral_Partner", "Organic_Search", "Social_Media", "Content_Marketing"
};

int vuser_init() {
    lr_output_message("Starting LoadRunner test for Bt");
    
    // Initialize LoadRunner variables with proper Dynatrace tagging
    lr_save_string("BizObs-Journey-LoadTest", "LSN");  // Load Script Name
    lr_save_string("Bt_Performance_Test_2026-02-05T09-19-25-622Z", "LTN");  // Load Test Name
    
    // Generate unique customer profile for this virtual user
    srand(time(NULL) + lr_get_vuser_id());
    int customer_index = rand() % 16;
    lr_save_string(customer_names[customer_index], "customer_name");
    lr_save_string(customer_emails[customer_index], "customer_email");
    lr_save_string(customer_segments[rand() % 6], "customer_segment");
    lr_save_string(traffic_sources[rand() % 8], "traffic_source");
    
    // Set web replay settings for better performance
    web_set_max_html_param_len("1024000");
    web_set_max_retries("3");
    web_set_timeout("Receive", 30);
    web_set_user_agent("LoadRunner-BizObs-Agent/1.0");
    
    return 0;
}

int vuser_end() {
    lr_output_message("Completed LoadRunner test for Bt - Customer: {customer_name}");
    return 0;
}

int Action() {
    int iteration = lr_get_iteration_number();
    int vuser_id = lr_get_vuser_id();
    
    // Generate unique correlation ID for each iteration
    sprintf(correlation_id, "LR_Bt_LoadTest_20260205_%d_%d_%d", vuser_id, iteration, (int)time(NULL));
    lr_save_string(correlation_id, "correlation_id");
    
    // Generate customer and session IDs with unique values per test run
    sprintf(customer_id, "customer_%d_%d_%d", vuser_id, iteration, (int)time(NULL) % 10000);
    sprintf(session_id, "session_BizObs_Bt_www.bt.com_Journey_%d_%d", vuser_id, iteration);
    sprintf(trace_id, "trace_%s_%d", correlation_id, (int)time(NULL));
    
    lr_save_string(customer_id, "customer_id");
    lr_save_string(session_id, "session_id");
    lr_save_string(trace_id, "trace_id");
    
    // Set up LoadRunner parameters for LSN/TSN/LTN
    lr_save_string("BizObs_Bt_www.bt.com_Journey", "LSN");  // Load Script Name
    lr_save_string("Bt_LoadTest_20260205", "LTN");  // Load Test Name
    
    lr_start_transaction("Full_Customer_Journey");
    lr_output_message("Starting journey for customer: {customer_name} ({customer_segment}) - Journey: %s", correlation_id);

    // Step 1: ComparisonClickthrough - User arrives from a comparison site (e.g. Uswitch) and clicks through to a BT Full Fibre product such as BTFF500. Generates measurable events: campaign_click, referral_source_identified, product_impression.
    lr_save_string("ComparisonClickthrough", "TSN");  // Test Step Name for this step
    
    // Build X-dynaTrace header with LSN, TSN, LTN (same format as single simulation)
    sprintf(dt_test_header, "TSN=%s;LSN=%s;LTN=%s;VU=%d;SI=LoadRunner;PC=BizObs-Demo;AN=Bt;CID=%s", 
            "ComparisonClickthrough", "BizObs_Bt_www.bt.com_Journey", "Bt_LoadTest_20260205", lr_get_vuser_id(), "{correlation_id}");
    
    lr_start_transaction("ComparisonClickthrough");
    lr_output_message("Executing step: ComparisonClickthrough (Service: ComparisonClickthroughService) for {customer_name}");
    
    // Add all headers exactly as single simulation does
    web_add_header("X-dynaTrace", dt_test_header);
    web_add_header("x-correlation-id", "{correlation_id}");
    web_add_header("x-customer-id", "{customer_id}");
    web_add_header("x-session-id", "{session_id}");
    web_add_header("x-trace-id", "{trace_id}");
    web_add_header("x-step-name", "ComparisonClickthrough");
    web_add_header("x-service-name", "ComparisonClickthroughService");
    web_add_header("x-customer-segment", "{customer_segment}");
    web_add_header("x-traffic-source", "{traffic_source}");
    web_add_header("x-test-iteration", lr_eval_string("{pIteration}"));
    web_add_header("Content-Type", "application/json");
    web_add_header("User-Agent", "LoadRunner-BizObs-Agent/1.0");
    
    // Use exact journey format as single simulation - with journey.steps structure
    web_custom_request("ComparisonClickthrough_Journey_Step",
        "URL=http://localhost:8080/api/journey-simulation/simulate-journey",
        "Method=POST",
        "Resource=0",
        "RecContentType=application/json",
        "Body="
        "{"
        "\"journeyId\": \"{correlation_id}\","
        "\"customerId\": \"{customer_id}\","
        "\"sessionId\": \"{session_id}\","
        "\"traceId\": \"{trace_id}\","
        "\"chained\": true,"
        "\"thinkTimeMs\": 250,"
        "\"errorSimulationEnabled\": false,"
        "\"journey\": {"
        "  \"journeyId\": \"{correlation_id}\","
        "  \"companyName\": \"Bt\","
        "  \"domain\": \"www.bt.com\","
        "  \"steps\": ["
        "    {"
        "      \"stepNumber\": 1,"
        "      \"stepName\": \"ComparisonClickthrough\","
        "      \"serviceName\": \"ComparisonClickthroughService\","
        "      \"description\": \"User arrives from a comparison site (e.g. Uswitch) and clicks through to a BT Full Fibre product such as BTFF500. Generates measurable events: campaign_click, referral_source_identified, product_impression.\","
        "      \"estimatedDuration\": 2,"
        "      \"substeps\": [{"substepName":"ReferralLandingPageView","duration":1},{"substepName":"ProductClickthrough","duration":1}]"
        "    }"
        "  ],"
        "  \"additionalFields\": {},"
        "  \"customerProfile\": {"
        "    \"name\": \"{customer_name}\","
        "    \"email\": \"{customer_email}\","
        "    \"segment\": \"{customer_segment}\","
        "    \"userId\": \"{customer_id}\","
        "    \"deviceType\": \"desktop\","
        "    \"location\": \"US-East\""
        "  }"
        "}"
        "}",
        LAST);
    
    // Check response for errors and handle accordingly
    if (atoi(lr_eval_string("{status}")) >= 400) {
        lr_error_message("Step ComparisonClickthrough failed with status: %s", lr_eval_string("{status}"));
        lr_end_transaction("ComparisonClickthrough", LR_FAIL);
    } else {
        lr_end_transaction("ComparisonClickthrough", LR_PASS);
    }
    
    // Clear headers for next request
    web_cleanup_cookies();
    web_revert_auto_header("x-dynatrace-test");
    web_revert_auto_header("x-correlation-id");
    web_revert_auto_header("x-customer-id");
    web_revert_auto_header("x-session-id");
    web_revert_auto_header("x-trace-id");
    web_revert_auto_header("x-step-name");
    web_revert_auto_header("x-customer-segment");
    web_revert_auto_header("x-traffic-source");
    web_revert_auto_header("x-test-iteration");
    
    lr_end_transaction("{TSN}", LR_AUTO);
    lr_output_message("Completed step: {TSN} - Response time: %d ms", lr_get_transaction_duration("{TSN}"));
    
    // Variable think time based on step complexity
    lr_think_time(5);


    // Step 2: PlanSelection - User compares BT broadband plans (BTFF500, BTFF900) and selects a preferred speed tier. Generates events: product_view, plan_compare, plan_selected.
    lr_save_string("PlanSelection", "TSN");  // Test Step Name for this step
    
    // Build X-dynaTrace header with LSN, TSN, LTN (same format as single simulation)
    sprintf(dt_test_header, "TSN=%s;LSN=%s;LTN=%s;VU=%d;SI=LoadRunner;PC=BizObs-Demo;AN=Bt;CID=%s", 
            "PlanSelection", "BizObs_Bt_www.bt.com_Journey", "Bt_LoadTest_20260205", lr_get_vuser_id(), "{correlation_id}");
    
    lr_start_transaction("PlanSelection");
    lr_output_message("Executing step: PlanSelection (Service: PlanSelectionService) for {customer_name}");
    
    // Add all headers exactly as single simulation does
    web_add_header("X-dynaTrace", dt_test_header);
    web_add_header("x-correlation-id", "{correlation_id}");
    web_add_header("x-customer-id", "{customer_id}");
    web_add_header("x-session-id", "{session_id}");
    web_add_header("x-trace-id", "{trace_id}");
    web_add_header("x-step-name", "PlanSelection");
    web_add_header("x-service-name", "PlanSelectionService");
    web_add_header("x-customer-segment", "{customer_segment}");
    web_add_header("x-traffic-source", "{traffic_source}");
    web_add_header("x-test-iteration", lr_eval_string("{pIteration}"));
    web_add_header("Content-Type", "application/json");
    web_add_header("User-Agent", "LoadRunner-BizObs-Agent/1.0");
    
    // Use exact journey format as single simulation - with journey.steps structure
    web_custom_request("PlanSelection_Journey_Step",
        "URL=http://localhost:8080/api/journey-simulation/simulate-journey",
        "Method=POST",
        "Resource=0",
        "RecContentType=application/json",
        "Body="
        "{"
        "\"journeyId\": \"{correlation_id}\","
        "\"customerId\": \"{customer_id}\","
        "\"sessionId\": \"{session_id}\","
        "\"traceId\": \"{trace_id}\","
        "\"chained\": true,"
        "\"thinkTimeMs\": 250,"
        "\"errorSimulationEnabled\": false,"
        "\"journey\": {"
        "  \"journeyId\": \"{correlation_id}\","
        "  \"companyName\": \"Bt\","
        "  \"domain\": \"www.bt.com\","
        "  \"steps\": ["
        "    {"
        "      \"stepNumber\": 2,"
        "      \"stepName\": \"PlanSelection\","
        "      \"serviceName\": \"PlanSelectionService\","
        "      \"description\": \"User compares BT broadband plans (BTFF500, BTFF900) and selects a preferred speed tier. Generates events: product_view, plan_compare, plan_selected.\","
        "      \"estimatedDuration\": 4,"
        "      \"substeps\": [{"substepName":"PlanGridLoad","duration":2},{"substepName":"PlanEvaluationAndSelection","duration":2}]"
        "    }"
        "  ],"
        "  \"additionalFields\": {},"
        "  \"customerProfile\": {"
        "    \"name\": \"{customer_name}\","
        "    \"email\": \"{customer_email}\","
        "    \"segment\": \"{customer_segment}\","
        "    \"userId\": \"{customer_id}\","
        "    \"deviceType\": \"desktop\","
        "    \"location\": \"US-East\""
        "  }"
        "}"
        "}",
        LAST);
    
    // Check response for errors and handle accordingly
    if (atoi(lr_eval_string("{status}")) >= 400) {
        lr_error_message("Step PlanSelection failed with status: %s", lr_eval_string("{status}"));
        lr_end_transaction("PlanSelection", LR_FAIL);
    } else {
        lr_end_transaction("PlanSelection", LR_PASS);
    }
    
    // Clear headers for next request
    web_cleanup_cookies();
    web_revert_auto_header("x-dynatrace-test");
    web_revert_auto_header("x-correlation-id");
    web_revert_auto_header("x-customer-id");
    web_revert_auto_header("x-session-id");
    web_revert_auto_header("x-trace-id");
    web_revert_auto_header("x-step-name");
    web_revert_auto_header("x-customer-segment");
    web_revert_auto_header("x-traffic-source");
    web_revert_auto_header("x-test-iteration");
    
    lr_end_transaction("{TSN}", LR_AUTO);
    lr_output_message("Completed step: {TSN} - Response time: %d ms", lr_get_transaction_duration("{TSN}"));
    
    // Variable think time based on step complexity
    lr_think_time(5);


    // Step 3: IdentityVerification - User logs in or creates a BT ID, completes email/SMS verification. Generates events: login_success, account_created, identity_verified.
    lr_save_string("IdentityVerification", "TSN");  // Test Step Name for this step
    
    // Build X-dynaTrace header with LSN, TSN, LTN (same format as single simulation)
    sprintf(dt_test_header, "TSN=%s;LSN=%s;LTN=%s;VU=%d;SI=LoadRunner;PC=BizObs-Demo;AN=Bt;CID=%s", 
            "IdentityVerification", "BizObs_Bt_www.bt.com_Journey", "Bt_LoadTest_20260205", lr_get_vuser_id(), "{correlation_id}");
    
    lr_start_transaction("IdentityVerification");
    lr_output_message("Executing step: IdentityVerification (Service: IdentityVerificationService) for {customer_name}");
    
    // Add all headers exactly as single simulation does
    web_add_header("X-dynaTrace", dt_test_header);
    web_add_header("x-correlation-id", "{correlation_id}");
    web_add_header("x-customer-id", "{customer_id}");
    web_add_header("x-session-id", "{session_id}");
    web_add_header("x-trace-id", "{trace_id}");
    web_add_header("x-step-name", "IdentityVerification");
    web_add_header("x-service-name", "IdentityVerificationService");
    web_add_header("x-customer-segment", "{customer_segment}");
    web_add_header("x-traffic-source", "{traffic_source}");
    web_add_header("x-test-iteration", lr_eval_string("{pIteration}"));
    web_add_header("Content-Type", "application/json");
    web_add_header("User-Agent", "LoadRunner-BizObs-Agent/1.0");
    
    // Use exact journey format as single simulation - with journey.steps structure
    web_custom_request("IdentityVerification_Journey_Step",
        "URL=http://localhost:8080/api/journey-simulation/simulate-journey",
        "Method=POST",
        "Resource=0",
        "RecContentType=application/json",
        "Body="
        "{"
        "\"journeyId\": \"{correlation_id}\","
        "\"customerId\": \"{customer_id}\","
        "\"sessionId\": \"{session_id}\","
        "\"traceId\": \"{trace_id}\","
        "\"chained\": true,"
        "\"thinkTimeMs\": 250,"
        "\"errorSimulationEnabled\": false,"
        "\"journey\": {"
        "  \"journeyId\": \"{correlation_id}\","
        "  \"companyName\": \"Bt\","
        "  \"domain\": \"www.bt.com\","
        "  \"steps\": ["
        "    {"
        "      \"stepNumber\": 3,"
        "      \"stepName\": \"IdentityVerification\","
        "      \"serviceName\": \"IdentityVerificationService\","
        "      \"description\": \"User logs in or creates a BT ID, completes email/SMS verification. Generates events: login_success, account_created, identity_verified.\","
        "      \"estimatedDuration\": 3,"
        "      \"substeps\": [{"substepName":"LoginOrRegistration","duration":1},{"substepName":"OTPVerification","duration":2}]"
        "    }"
        "  ],"
        "  \"additionalFields\": {},"
        "  \"customerProfile\": {"
        "    \"name\": \"{customer_name}\","
        "    \"email\": \"{customer_email}\","
        "    \"segment\": \"{customer_segment}\","
        "    \"userId\": \"{customer_id}\","
        "    \"deviceType\": \"desktop\","
        "    \"location\": \"US-East\""
        "  }"
        "}"
        "}",
        LAST);
    
    // Check response for errors and handle accordingly
    if (atoi(lr_eval_string("{status}")) >= 400) {
        lr_error_message("Step IdentityVerification failed with status: %s", lr_eval_string("{status}"));
        lr_end_transaction("IdentityVerification", LR_FAIL);
    } else {
        lr_end_transaction("IdentityVerification", LR_PASS);
    }
    
    // Clear headers for next request
    web_cleanup_cookies();
    web_revert_auto_header("x-dynatrace-test");
    web_revert_auto_header("x-correlation-id");
    web_revert_auto_header("x-customer-id");
    web_revert_auto_header("x-session-id");
    web_revert_auto_header("x-trace-id");
    web_revert_auto_header("x-step-name");
    web_revert_auto_header("x-customer-segment");
    web_revert_auto_header("x-traffic-source");
    web_revert_auto_header("x-test-iteration");
    
    lr_end_transaction("{TSN}", LR_AUTO);
    lr_output_message("Completed step: {TSN} - Response time: %d ms", lr_get_transaction_duration("{TSN}"));
    
    // Variable think time based on step complexity
    lr_think_time(5);


    // Step 4: BasketReview - User reviews selected plan, evaluates add-ons (e.g. Complete Wi-Fi), and confirms basket contents. Generates events: basket_viewed, add_on_added, basket_value_updated.
    lr_save_string("BasketReview", "TSN");  // Test Step Name for this step
    
    // Build X-dynaTrace header with LSN, TSN, LTN (same format as single simulation)
    sprintf(dt_test_header, "TSN=%s;LSN=%s;LTN=%s;VU=%d;SI=LoadRunner;PC=BizObs-Demo;AN=Bt;CID=%s", 
            "BasketReview", "BizObs_Bt_www.bt.com_Journey", "Bt_LoadTest_20260205", lr_get_vuser_id(), "{correlation_id}");
    
    lr_start_transaction("BasketReview");
    lr_output_message("Executing step: BasketReview (Service: BasketReviewService) for {customer_name}");
    
    // Add all headers exactly as single simulation does
    web_add_header("X-dynaTrace", dt_test_header);
    web_add_header("x-correlation-id", "{correlation_id}");
    web_add_header("x-customer-id", "{customer_id}");
    web_add_header("x-session-id", "{session_id}");
    web_add_header("x-trace-id", "{trace_id}");
    web_add_header("x-step-name", "BasketReview");
    web_add_header("x-service-name", "BasketReviewService");
    web_add_header("x-customer-segment", "{customer_segment}");
    web_add_header("x-traffic-source", "{traffic_source}");
    web_add_header("x-test-iteration", lr_eval_string("{pIteration}"));
    web_add_header("Content-Type", "application/json");
    web_add_header("User-Agent", "LoadRunner-BizObs-Agent/1.0");
    
    // Use exact journey format as single simulation - with journey.steps structure
    web_custom_request("BasketReview_Journey_Step",
        "URL=http://localhost:8080/api/journey-simulation/simulate-journey",
        "Method=POST",
        "Resource=0",
        "RecContentType=application/json",
        "Body="
        "{"
        "\"journeyId\": \"{correlation_id}\","
        "\"customerId\": \"{customer_id}\","
        "\"sessionId\": \"{session_id}\","
        "\"traceId\": \"{trace_id}\","
        "\"chained\": true,"
        "\"thinkTimeMs\": 250,"
        "\"errorSimulationEnabled\": false,"
        "\"journey\": {"
        "  \"journeyId\": \"{correlation_id}\","
        "  \"companyName\": \"Bt\","
        "  \"domain\": \"www.bt.com\","
        "  \"steps\": ["
        "    {"
        "      \"stepNumber\": 4,"
        "      \"stepName\": \"BasketReview\","
        "      \"serviceName\": \"BasketReviewService\","
        "      \"description\": \"User reviews selected plan, evaluates add-ons (e.g. Complete Wi-Fi), and confirms basket contents. Generates events: basket_viewed, add_on_added, basket_value_updated.\","
        "      \"estimatedDuration\": 3,"
        "      \"substeps\": [{"substepName":"BasketSummaryLoad","duration":1},{"substepName":"AddOnReviewAndConfirmation","duration":2}]"
        "    }"
        "  ],"
        "  \"additionalFields\": {},"
        "  \"customerProfile\": {"
        "    \"name\": \"{customer_name}\","
        "    \"email\": \"{customer_email}\","
        "    \"segment\": \"{customer_segment}\","
        "    \"userId\": \"{customer_id}\","
        "    \"deviceType\": \"desktop\","
        "    \"location\": \"US-East\""
        "  }"
        "}"
        "}",
        LAST);
    
    // Check response for errors and handle accordingly
    if (atoi(lr_eval_string("{status}")) >= 400) {
        lr_error_message("Step BasketReview failed with status: %s", lr_eval_string("{status}"));
        lr_end_transaction("BasketReview", LR_FAIL);
    } else {
        lr_end_transaction("BasketReview", LR_PASS);
    }
    
    // Clear headers for next request
    web_cleanup_cookies();
    web_revert_auto_header("x-dynatrace-test");
    web_revert_auto_header("x-correlation-id");
    web_revert_auto_header("x-customer-id");
    web_revert_auto_header("x-session-id");
    web_revert_auto_header("x-trace-id");
    web_revert_auto_header("x-step-name");
    web_revert_auto_header("x-customer-segment");
    web_revert_auto_header("x-traffic-source");
    web_revert_auto_header("x-test-iteration");
    
    lr_end_transaction("{TSN}", LR_AUTO);
    lr_output_message("Completed step: {TSN} - Response time: %d ms", lr_get_transaction_duration("{TSN}"));
    
    // Variable think time based on step complexity
    lr_think_time(5);


    // Step 5: CheckoutPayment - User enters billing details, sets up Direct Debit, and authorises payment. Generates events: checkout_started, payment_method_added, payment_authorised, checkout_completed.
    lr_save_string("CheckoutPayment", "TSN");  // Test Step Name for this step
    
    // Build X-dynaTrace header with LSN, TSN, LTN (same format as single simulation)
    sprintf(dt_test_header, "TSN=%s;LSN=%s;LTN=%s;VU=%d;SI=LoadRunner;PC=BizObs-Demo;AN=Bt;CID=%s", 
            "CheckoutPayment", "BizObs_Bt_www.bt.com_Journey", "Bt_LoadTest_20260205", lr_get_vuser_id(), "{correlation_id}");
    
    lr_start_transaction("CheckoutPayment");
    lr_output_message("Executing step: CheckoutPayment (Service: CheckoutPaymentService) for {customer_name}");
    
    // Add all headers exactly as single simulation does
    web_add_header("X-dynaTrace", dt_test_header);
    web_add_header("x-correlation-id", "{correlation_id}");
    web_add_header("x-customer-id", "{customer_id}");
    web_add_header("x-session-id", "{session_id}");
    web_add_header("x-trace-id", "{trace_id}");
    web_add_header("x-step-name", "CheckoutPayment");
    web_add_header("x-service-name", "CheckoutPaymentService");
    web_add_header("x-customer-segment", "{customer_segment}");
    web_add_header("x-traffic-source", "{traffic_source}");
    web_add_header("x-test-iteration", lr_eval_string("{pIteration}"));
    web_add_header("Content-Type", "application/json");
    web_add_header("User-Agent", "LoadRunner-BizObs-Agent/1.0");
    
    // Use exact journey format as single simulation - with journey.steps structure
    web_custom_request("CheckoutPayment_Journey_Step",
        "URL=http://localhost:8080/api/journey-simulation/simulate-journey",
        "Method=POST",
        "Resource=0",
        "RecContentType=application/json",
        "Body="
        "{"
        "\"journeyId\": \"{correlation_id}\","
        "\"customerId\": \"{customer_id}\","
        "\"sessionId\": \"{session_id}\","
        "\"traceId\": \"{trace_id}\","
        "\"chained\": true,"
        "\"thinkTimeMs\": 250,"
        "\"errorSimulationEnabled\": false,"
        "\"journey\": {"
        "  \"journeyId\": \"{correlation_id}\","
        "  \"companyName\": \"Bt\","
        "  \"domain\": \"www.bt.com\","
        "  \"steps\": ["
        "    {"
        "      \"stepNumber\": 5,"
        "      \"stepName\": \"CheckoutPayment\","
        "      \"serviceName\": \"CheckoutPaymentService\","
        "      \"description\": \"User enters billing details, sets up Direct Debit, and authorises payment. Generates events: checkout_started, payment_method_added, payment_authorised, checkout_completed.\","
        "      \"estimatedDuration\": 5,"
        "      \"substeps\": [{"substepName":"BillingDetailsEntry","duration":2},{"substepName":"DirectDebitSetupAndPayment","duration":3}]"
        "    }"
        "  ],"
        "  \"additionalFields\": {},"
        "  \"customerProfile\": {"
        "    \"name\": \"{customer_name}\","
        "    \"email\": \"{customer_email}\","
        "    \"segment\": \"{customer_segment}\","
        "    \"userId\": \"{customer_id}\","
        "    \"deviceType\": \"desktop\","
        "    \"location\": \"US-East\""
        "  }"
        "}"
        "}",
        LAST);
    
    // Check response for errors and handle accordingly
    if (atoi(lr_eval_string("{status}")) >= 400) {
        lr_error_message("Step CheckoutPayment failed with status: %s", lr_eval_string("{status}"));
        lr_end_transaction("CheckoutPayment", LR_FAIL);
    } else {
        lr_end_transaction("CheckoutPayment", LR_PASS);
    }
    
    // Clear headers for next request
    web_cleanup_cookies();
    web_revert_auto_header("x-dynatrace-test");
    web_revert_auto_header("x-correlation-id");
    web_revert_auto_header("x-customer-id");
    web_revert_auto_header("x-session-id");
    web_revert_auto_header("x-trace-id");
    web_revert_auto_header("x-step-name");
    web_revert_auto_header("x-customer-segment");
    web_revert_auto_header("x-traffic-source");
    web_revert_auto_header("x-test-iteration");
    
    lr_end_transaction("{TSN}", LR_AUTO);
    lr_output_message("Completed step: {TSN} - Response time: %d ms", lr_get_transaction_duration("{TSN}"));
    
    // Variable think time based on step complexity
    lr_think_time(5);


    // Step 6: OrderConfirmationProvisioning - User receives order confirmation, contract summary, and activation date. Generates events: order_confirmed, contract_value_recorded, provisioning_request_created.
    lr_save_string("OrderConfirmationProvisioning", "TSN");  // Test Step Name for this step
    
    // Build X-dynaTrace header with LSN, TSN, LTN (same format as single simulation)
    sprintf(dt_test_header, "TSN=%s;LSN=%s;LTN=%s;VU=%d;SI=LoadRunner;PC=BizObs-Demo;AN=Bt;CID=%s", 
            "OrderConfirmationProvisioning", "BizObs_Bt_www.bt.com_Journey", "Bt_LoadTest_20260205", lr_get_vuser_id(), "{correlation_id}");
    
    lr_start_transaction("OrderConfirmationProvisioning");
    lr_output_message("Executing step: OrderConfirmationProvisioning (Service: OrderConfirmationProvisioningService) for {customer_name}");
    
    // Add all headers exactly as single simulation does
    web_add_header("X-dynaTrace", dt_test_header);
    web_add_header("x-correlation-id", "{correlation_id}");
    web_add_header("x-customer-id", "{customer_id}");
    web_add_header("x-session-id", "{session_id}");
    web_add_header("x-trace-id", "{trace_id}");
    web_add_header("x-step-name", "OrderConfirmationProvisioning");
    web_add_header("x-service-name", "OrderConfirmationProvisioningService");
    web_add_header("x-customer-segment", "{customer_segment}");
    web_add_header("x-traffic-source", "{traffic_source}");
    web_add_header("x-test-iteration", lr_eval_string("{pIteration}"));
    web_add_header("Content-Type", "application/json");
    web_add_header("User-Agent", "LoadRunner-BizObs-Agent/1.0");
    
    // Use exact journey format as single simulation - with journey.steps structure
    web_custom_request("OrderConfirmationProvisioning_Journey_Step",
        "URL=http://localhost:8080/api/journey-simulation/simulate-journey",
        "Method=POST",
        "Resource=0",
        "RecContentType=application/json",
        "Body="
        "{"
        "\"journeyId\": \"{correlation_id}\","
        "\"customerId\": \"{customer_id}\","
        "\"sessionId\": \"{session_id}\","
        "\"traceId\": \"{trace_id}\","
        "\"chained\": true,"
        "\"thinkTimeMs\": 250,"
        "\"errorSimulationEnabled\": false,"
        "\"journey\": {"
        "  \"journeyId\": \"{correlation_id}\","
        "  \"companyName\": \"Bt\","
        "  \"domain\": \"www.bt.com\","
        "  \"steps\": ["
        "    {"
        "      \"stepNumber\": 6,"
        "      \"stepName\": \"OrderConfirmationProvisioning\","
        "      \"serviceName\": \"OrderConfirmationProvisioningService\","
        "      \"description\": \"User receives order confirmation, contract summary, and activation date. Generates events: order_confirmed, contract_value_recorded, provisioning_request_created.\","
        "      \"estimatedDuration\": 2,"
        "      \"substeps\": [{"substepName":"OrderConfirmationView","duration":1},{"substepName":"ProvisioningRequestInitiated","duration":1}]"
        "    }"
        "  ],"
        "  \"additionalFields\": {},"
        "  \"customerProfile\": {"
        "    \"name\": \"{customer_name}\","
        "    \"email\": \"{customer_email}\","
        "    \"segment\": \"{customer_segment}\","
        "    \"userId\": \"{customer_id}\","
        "    \"deviceType\": \"desktop\","
        "    \"location\": \"US-East\""
        "  }"
        "}"
        "}",
        LAST);
    
    // Check response for errors and handle accordingly
    if (atoi(lr_eval_string("{status}")) >= 400) {
        lr_error_message("Step OrderConfirmationProvisioning failed with status: %s", lr_eval_string("{status}"));
        lr_end_transaction("OrderConfirmationProvisioning", LR_FAIL);
    } else {
        lr_end_transaction("OrderConfirmationProvisioning", LR_PASS);
    }
    
    // Clear headers for next request
    web_cleanup_cookies();
    web_revert_auto_header("x-dynatrace-test");
    web_revert_auto_header("x-correlation-id");
    web_revert_auto_header("x-customer-id");
    web_revert_auto_header("x-session-id");
    web_revert_auto_header("x-trace-id");
    web_revert_auto_header("x-step-name");
    web_revert_auto_header("x-customer-segment");
    web_revert_auto_header("x-traffic-source");
    web_revert_auto_header("x-test-iteration");
    
    lr_end_transaction("{TSN}", LR_AUTO);
    lr_output_message("Completed step: {TSN} - Response time: %d ms", lr_get_transaction_duration("{TSN}"));
    
    // Variable think time based on step complexity
    lr_think_time(5);

    lr_end_transaction("Full_Customer_Journey", LR_AUTO);
    
    // Log completion with full context
    lr_output_message("Journey completed for {customer_name} - Total time: %d ms, Correlation: {correlation_id}", 
                     lr_get_transaction_duration("Full_Customer_Journey"));
    
    // Optional: Add business events for completion tracking
    web_add_header("x-dynatrace-test", dt_test_header);
    web_add_header("x-correlation-id", "{correlation_id}");
    web_add_header("Content-Type", "application/json");
    
    web_custom_request("Journey_Completion_Event",
        "URL=http://localhost:8080/api/journey-simulation/simulate-journey",
        "Method=POST",
        "Resource=0",
        "RecContentType=application/json",
        "Body="
        "{"
        "\"eventType\": \"journey_completed\","
        "\"correlationId\": \"{correlation_id}\","
        "\"customerId\": \"{customer_id}\","
        "\"companyName\": \"Bt\","
        "\"customerName\": \"{customer_name}\","
        "\"customerSegment\": \"{customer_segment}\","
        "\"totalSteps\": 6,"
        "\"loadTest\": true,"
        "\"completionTime\": \"" + lr_eval_string("{TimeNow}") + "\""
        "}",
        LAST);
    
    return 0;
}