/*
 * LoadRunner Script Generated from BizObs Journey Configuration
 * Company: Argos
 * Domain: www.Argos.co.uk
 * Generated: 2026-01-06T14:00:16.681Z
 * Test ID: 1b5bdb17-d724-4785-a1b0-c9053b6d07d0
 * 
 * Dynatrace LoadRunner Integration with Request Tagging
 * LSN: BizObs_Argos_www.Argos.co.uk_Journey (Load Script Name)
 * TSN: Dynamic per step (Test Step Names)
 * LTN: Argos_LoadTest_20260106 (Load Test Name)
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
    lr_output_message("Starting LoadRunner test for Argos");
    
    // Initialize LoadRunner variables with proper Dynatrace tagging
    lr_save_string("BizObs-Journey-LoadTest", "LSN");  // Load Script Name
    lr_save_string("Argos_Performance_Test_2026-01-06T14-00-16-681Z", "LTN");  // Load Test Name
    
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
    lr_output_message("Completed LoadRunner test for Argos - Customer: {customer_name}");
    return 0;
}

int Action() {
    int iteration = lr_get_iteration_number();
    int vuser_id = lr_get_vuser_id();
    
    // Generate unique correlation ID for each iteration
    sprintf(correlation_id, "LR_Argos_LoadTest_20260106_%d_%d_%d", vuser_id, iteration, (int)time(NULL));
    lr_save_string(correlation_id, "correlation_id");
    
    // Generate customer and session IDs with unique values per test run
    sprintf(customer_id, "customer_%d_%d_%d", vuser_id, iteration, (int)time(NULL) % 10000);
    sprintf(session_id, "session_BizObs_Argos_www.Argos.co.uk_Journey_%d_%d", vuser_id, iteration);
    sprintf(trace_id, "trace_%s_%d", correlation_id, (int)time(NULL));
    
    lr_save_string(customer_id, "customer_id");
    lr_save_string(session_id, "session_id");
    lr_save_string(trace_id, "trace_id");
    
    // Set up LoadRunner parameters for LSN/TSN/LTN
    lr_save_string("BizObs_Argos_www.Argos.co.uk_Journey", "LSN");  // Load Script Name
    lr_save_string("Argos_LoadTest_20260106", "LTN");  // Load Test Name
    
    lr_start_transaction("Full_Customer_Journey");
    lr_output_message("Starting journey for customer: {customer_name} ({customer_segment}) - Journey: %s", correlation_id);

    // Step 1: ProductDiscovery - Customer searches for products, views categories, and opens product detail pages.
    lr_save_string("ProductDiscovery", "TSN");  // Test Step Name for this step
    
    // Build X-dynaTrace header with LSN, TSN, LTN (same format as single simulation)
    sprintf(dt_test_header, "TSN=%s;LSN=%s;LTN=%s;VU=%d;SI=LoadRunner;PC=BizObs-Demo;AN=Argos;CID=%s", 
            "ProductDiscovery", "BizObs_Argos_www.Argos.co.uk_Journey", "Argos_LoadTest_20260106", lr_get_vuser_id(), "{correlation_id}");
    
    lr_start_transaction("ProductDiscovery");
    lr_output_message("Executing step: ProductDiscovery (Service: ProductDiscoveryService) for {customer_name}");
    
    // Add all headers exactly as single simulation does
    web_add_header("X-dynaTrace", dt_test_header);
    web_add_header("x-correlation-id", "{correlation_id}");
    web_add_header("x-customer-id", "{customer_id}");
    web_add_header("x-session-id", "{session_id}");
    web_add_header("x-trace-id", "{trace_id}");
    web_add_header("x-step-name", "ProductDiscovery");
    web_add_header("x-service-name", "ProductDiscoveryService");
    web_add_header("x-customer-segment", "{customer_segment}");
    web_add_header("x-traffic-source", "{traffic_source}");
    web_add_header("x-test-iteration", lr_eval_string("{pIteration}"));
    web_add_header("Content-Type", "application/json");
    web_add_header("User-Agent", "LoadRunner-BizObs-Agent/1.0");
    
    // Use exact journey format as single simulation - with journey.steps structure
    web_custom_request("ProductDiscovery_Journey_Step",
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
        "\"errorSimulationEnabled\": true,"
        "\"journey\": {"
        "  \"journeyId\": \"{correlation_id}\","
        "  \"companyName\": \"Argos\","
        "  \"domain\": \"www.Argos.co.uk\","
        "  \"steps\": ["
        "    {"
        "      \"stepNumber\": 1,"
        "      \"stepName\": \"ProductDiscovery\","
        "      \"serviceName\": \"ProductDiscoveryService\","
        "      \"description\": \"Customer searches for products, views categories, and opens product detail pages.\","
        "      \"estimatedDuration\": 4000,"
        "      \"substeps\": [{"substepName":"Search for Nintendo Switch Console","duration":1000},{"substepName":"View product detail page SKU: 123/4567 (£259.99)","duration":1000}]"
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
        lr_error_message("Step ProductDiscovery failed with status: %s", lr_eval_string("{status}"));
        lr_end_transaction("ProductDiscovery", LR_FAIL);
    } else {
        lr_end_transaction("ProductDiscovery", LR_PASS);
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
    lr_think_time(4);


    // Step 2: BasketManagement - Customer adds multiple products to basket and reviews basket contents.
    lr_save_string("BasketManagement", "TSN");  // Test Step Name for this step
    
    // Build X-dynaTrace header with LSN, TSN, LTN (same format as single simulation)
    sprintf(dt_test_header, "TSN=%s;LSN=%s;LTN=%s;VU=%d;SI=LoadRunner;PC=BizObs-Demo;AN=Argos;CID=%s", 
            "BasketManagement", "BizObs_Argos_www.Argos.co.uk_Journey", "Argos_LoadTest_20260106", lr_get_vuser_id(), "{correlation_id}");
    
    lr_start_transaction("BasketManagement");
    lr_output_message("Executing step: BasketManagement (Service: BasketManagementService) for {customer_name}");
    
    // Add all headers exactly as single simulation does
    web_add_header("X-dynaTrace", dt_test_header);
    web_add_header("x-correlation-id", "{correlation_id}");
    web_add_header("x-customer-id", "{customer_id}");
    web_add_header("x-session-id", "{session_id}");
    web_add_header("x-trace-id", "{trace_id}");
    web_add_header("x-step-name", "BasketManagement");
    web_add_header("x-service-name", "BasketManagementService");
    web_add_header("x-customer-segment", "{customer_segment}");
    web_add_header("x-traffic-source", "{traffic_source}");
    web_add_header("x-test-iteration", lr_eval_string("{pIteration}"));
    web_add_header("Content-Type", "application/json");
    web_add_header("User-Agent", "LoadRunner-BizObs-Agent/1.0");
    
    // Use exact journey format as single simulation - with journey.steps structure
    web_custom_request("BasketManagement_Journey_Step",
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
        "\"errorSimulationEnabled\": true,"
        "\"journey\": {"
        "  \"journeyId\": \"{correlation_id}\","
        "  \"companyName\": \"Argos\","
        "  \"domain\": \"www.Argos.co.uk\","
        "  \"steps\": ["
        "    {"
        "      \"stepNumber\": 2,"
        "      \"stepName\": \"BasketManagement\","
        "      \"serviceName\": \"BasketManagementService\","
        "      \"description\": \"Customer adds multiple products to basket and reviews basket contents.\","
        "      \"estimatedDuration\": 3000,"
        "      \"substeps\": [{"substepName":"Add Nintendo Switch Console to basket","duration":1000}]"
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
        lr_error_message("Step BasketManagement failed with status: %s", lr_eval_string("{status}"));
        lr_end_transaction("BasketManagement", LR_FAIL);
    } else {
        lr_end_transaction("BasketManagement", LR_PASS);
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
    lr_think_time(3);

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
        "\"companyName\": \"Argos\","
        "\"customerName\": \"{customer_name}\","
        "\"customerSegment\": \"{customer_segment}\","
        "\"totalSteps\": 2,"
        "\"loadTest\": true,"
        "\"completionTime\": \"" + lr_eval_string("{TimeNow}") + "\""
        "}",
        LAST);
    
    return 0;
}