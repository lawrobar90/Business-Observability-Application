/**
 * Copilot Prompt Templates for Business Observability Journey Generation
 * 
 * These prompts guide GitHub Copilot to generate realistic customer journeys
 * with proper business events, revenue tracking, and observability metrics.
 */

export interface PromptVariables {
  companyName: string;
  domain: string;
  requirements?: string;
}

export const generateCsuitePrompt = (variables: PromptVariables): string => {
  const { companyName, domain, requirements } = variables;
  
  return `${companyName} at ${domain} is the focus for this chat.

You are a Business Observability specialist creating realistic customer journey simulations for application monitoring and business analytics platforms.

Your goal is to analyze ${companyName}'s digital business model to create accurate observability scenarios with proper business events, revenue tracking, and customer experience metrics that would be monitored in production.

Focus on ${companyName}'s digital touchpoints and business-critical user flows that generate measurable business outcomes. Analyze their:

**DIGITAL BUSINESS ARCHITECTURE:**
1. **Primary Revenue Streams**: What are their main monetization methods and typical transaction values?
2. **Critical User Journeys**: What are the 3 most important customer flows that drive revenue?
3. **Journey Classification**: What specific industry type and concise journey names describe their flows (e.g. "Trial Signup", "Purchase Journey")?
4. **Technology Stack**: What platforms, APIs, and services likely power their digital experience?

**OBSERVABILITY REQUIREMENTS:**
1. **Business Events**: What key business moments should be tracked (purchases, signups, upgrades, cancellations)?
2. **Revenue Attribution**: How do customer actions translate to measurable business value?
3. **Experience Metrics**: What user experience indicators impact their business outcomes?

**MONITORING PRIORITIES:**
1. **Performance Impact**: Which slow services would hurt their revenue most?
2. **Error Consequences**: What failures would cause immediate business loss?
3. **Conversion Tracking**: What steps in their funnel need observability data?

Return a structured analysis focusing on:
- Specific business events that need monitoring
- Revenue impact of different user actions
- Technology dependencies that affect customer experience
- Realistic conversion rates and transaction values for their industry
- Key performance indicators that matter for their business model

Base your analysis on publicly available information about ${companyName}'s business model, but focus on practical observability scenarios rather than generic business strategy.`;
};

export const generateJourneyPrompt = (variables: PromptVariables): string => {
  const { companyName, domain, requirements } = variables;
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const safeCompanyName = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  return `Create a business observability customer journey JSON for ${companyName} (${domain}) based on your previous analysis.

🎯 SPECIFIC JOURNEY REQUIREMENTS: "${requirements || 'Standard customer journey'}"

The customer journey MUST model the exact observability scenario described above. Design realistic business events, user interactions, and measurable outcomes that would appear in application monitoring dashboards and business analytics platforms.

⚠️ CRITICAL: Must include duration fields and business value tracking or response will be rejected ⚠️

Return JSON with this structure:
{
  "journey": {
    "companyName": "${companyName}",
    "domain": "${domain}",
    "industryType": "[Use industry from C-suite analysis]",
    "journeyType": "[Concise journey name like 'Trial Signup', 'Purchase Journey', 'Subscription Flow']",
    "journeyDetail": "[Same as journeyType - concise 2-3 word description]",
    "journeyId": "journey_${safeCompanyName}_2025",
    "journeyStartTime": "2025-11-21T00:00:00.000Z",
    "steps": [
      {
        "stepIndex": 1,
        "stepName": "[IndustrySpecificStepName]",
        "serviceName": "[IndustrySpecificStepNameService]",
        "description": "[What happens in this step]",
        "category": "[StepCategory]",
        "timestamp": "2025-11-21T00:00:00.000Z",
        "estimatedDuration": "[realistic_minutes]",
        "businessRationale": "[Why this duration for this industry]",
        "substeps": [
          {"substepName": "[substep description]", "duration": "[minutes]"},
          {"substepName": "[substep description]", "duration": "[minutes]"}
        ]
      }
    ]
  },
  "customerProfile": {
    "userId": "user_${safeCompanyName}_001",
    "email": "testuser@${cleanDomain}",
    "userSegment": "[High-value|Standard|New - based on ${companyName}'s segmentation]",
    "digitalBehaviorPattern": "[How they typically interact with ${companyName}]",
    "businessValueTier": "[Revenue potential of this user type]",
    "experienceExpectations": "[Performance and UX standards they expect]",
    "conversionLikelihood": "[Probability of completing business goal]",
    "technologyProfile": "[Device preferences, browser, connectivity affecting UX]"
  },
  "traceMetadata": {
    "correlationId": "trace_${safeCompanyName}_2025",
    "sessionId": "session_${safeCompanyName}_001",
    "businessContext": {
      "campaignSource": "[e.g. Organic Search, Paid Search, Social Media]",
      "customerSegment": "[e.g. premium, standard, enterprise]",
      "businessValue": "[e.g. £1,250]",
      "revenueImpact": "[e.g. £450 per customer]",
      "transactionAmount": "[e.g. £89.99]"
    }
  },
  "additionalFields": {
    "<<DYNAMICALLY GENERATE 20-40 fields based on your C-suite analysis, the industry, and this specific journey. Each field name should be camelCase. Use your knowledge of ${companyName}'s business model to create fields that would appear in real observability dashboards.

FIELD TYPE MIX — use all of these where applicable:
- REVENUE: numeric currency values (e.g. transactionValue: 67.49)
- METRIC: numeric decimals/integers for rates, scores, percentages (e.g. conversionRate: 0.72, netPromoterScore: 65)
- STRING: descriptive text, categories, statuses (e.g. loyaltyStatus: 'vip', pricingTier: 'Gold')
- PRODUCT ARRAYS: arrays of product names, SKUs, prices, and categories that represent the items in this journey (e.g. productName: ['Widget Pro', 'Widget Lite'], productSKU: ['SKU-WP-001', 'SKU-WL-002'], productPrice: [29.99, 19.99], productCategory: ['Electronics', 'Accessories'])

ARRAY RULES:
- Product-related fields MUST be arrays with 2-5 items representing realistic products for ${companyName}
- Parallel arrays must have the same length (e.g. if productName has 3 items, productSKU and productPrice must also have 3)
- Use industry-appropriate product names, SKU formats, and price points
- Other fields that naturally have multiple values may also be arrays (e.g. paymentMethods: ['card', 'paypal'], deliveryOptions: ['standard', 'express'])

Include fields for: revenue/financial data, customer behaviour, conversion metrics, risk/compliance, operational efficiency, product details (as arrays), engagement scores, and any industry-specific KPIs relevant to this journey.>>"
  }
}

Requirements:
- Create exactly 6 business-critical steps that generate measurable business events
- Every step needs estimatedDuration (minutes) and businessRationale explaining revenue/experience impact
- Every substep needs duration (minutes) - substeps must add up to step duration
- ServiceName = StepName + 'Service' in PascalCase format (for microservice architecture)
- Use realistic durations that match industry performance expectations
- Only step 1 needs timestamp field
- Replace ALL placeholders with actual values based on ${companyName}'s business model
- **CRITICAL: Set industryType to specific industry (e.g. "Cloud Software", "Streaming Media", "E-commerce")**
- **CRITICAL: Set journeyType and journeyDetail to concise 2-3 word journey name (e.g. "Trial Signup", "Purchase Journey", "Support Request")**
- **CRITICAL: additionalFields must be 20-40 key-value pairs — no nested objects. Dynamically generate field names based on this company and journey. Product-related fields (names, SKUs, prices, categories) MUST be parallel arrays with 2-5 items. Other fields are flat scalars. Each field must have a real value, not a placeholder.**
- **Field type rules: Revenue fields = numeric (e.g. 67.49), Metric fields = numeric (e.g. 0.72), String fields = text (e.g. "premium"), Product fields = identifiers (e.g. "SKU-001")**
- Focus on user actions that create business value and generate observable events
- Include realistic business metrics: conversion rates, transaction values, performance thresholds
- All business values should be realistic for their industry and market position
- All percentage values should be numeric (e.g. 0.72 not "72%")
- Durations must be numeric integers, not strings
- Focus on scenarios that would appear in business observability dashboards

Return the response in JSON code format that can be copied from this UI

⚠️ BUSINESS EVENT TRACKING REQUIRED: Each step must produce measurable business outcomes ⚠️`;
};

export const PROMPT_DESCRIPTIONS = {
  csuite: {
    title: 'C-suite Analysis',
    description: 'Analyzes the company from a business observability perspective, identifying key revenue streams, critical journeys, and monitoring priorities.',
    icon: '👔',
  },
  journey: {
    title: 'Customer Journey',
    description: 'Generates a detailed customer journey JSON with business events, metrics, and observability data for simulation and testing.',
    icon: '🗺️',
  },
};
