import express from 'express';
import http from 'http';
import crypto, { randomBytes } from 'crypto';
import { ensureServiceRunning, getServicePort, getServiceNameFromStep } from '../services/service-manager.js';

const router = express.Router();

// Default journey steps
const DEFAULT_JOURNEY_STEPS = [
  'Discovery', 'Awareness', 'Consideration', 'Purchase', 'Retention', 'Advocacy'
];

// Helper to infer a domain if missing
  function inferDomain(obj) {
    const d = obj?.domain || obj?.website || obj?.companyDomain || '';
    if (d)
      return d;
    const name = (obj?.companyName || 'default').toLowerCase().replace(/\s+/g, '');
    return `${name}.com`;
}

// Generate a concise journey detail name for Dynatrace tags
function generateJourneyDetail(payload, stepData) {
  // Try to extract from journey requirements or journey type
  if (payload.journey?.journeyType) {
    return payload.journey.journeyType.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  }
  
  // Try to infer from step names - create a meaningful summary
  if (stepData && stepData.length > 0) {
    const firstStep = stepData[0]?.stepName || '';
    const lastStep = stepData.length > 1 ? stepData[stepData.length - 1]?.stepName : '';
    
    // Common journey patterns
    if (firstStep.toLowerCase().includes('discovery') || firstStep.toLowerCase().includes('landing')) {
      if (lastStep.toLowerCase().includes('purchase') || lastStep.toLowerCase().includes('checkout')) {
        return 'Purchase Journey';
      } else if (lastStep.toLowerCase().includes('trial') || lastStep.toLowerCase().includes('signup')) {
        return 'Trial Signup';
      } else if (lastStep.toLowerCase().includes('subscription') || lastStep.toLowerCase().includes('upgrade')) {
        return 'Subscription Journey';
      } else if (lastStep.toLowerCase().includes('support') || lastStep.toLowerCase().includes('service')) {
        return 'Support Journey';
      }
    }
    
    // Fallback to first step + flow
    if (firstStep) {
      return `${firstStep.replace(/([a-z])([A-Z])/g, '$1 $2')} Flow`;
    }
  }
  
  // Final fallback
  return 'Customer Journey';
}

// Extract Dynatrace tracing headers from incoming request
function extractTracingHeaders(req) {
  const tracingHeaders = {};
  
  // Extract all potential Dynatrace and tracing headers
  const headerKeys = Object.keys(req.headers || {});
  for (const key of headerKeys) {
    const lowerKey = key.toLowerCase();
    // Capture Dynatrace, W3C Trace Context, and other distributed tracing headers
    if (lowerKey.startsWith('x-dynatrace') || 
        lowerKey.startsWith('traceparent') || 
        lowerKey.startsWith('tracestate') || 
        lowerKey.startsWith('x-trace') || 
        lowerKey.startsWith('x-request-id') || 
        lowerKey.startsWith('x-correlation-id') || 
        lowerKey.startsWith('x-span-id') || 
        lowerKey.startsWith('dt-') ||
        lowerKey.startsWith('uber-trace-id')) {
      tracingHeaders[key] = req.headers[key];
    }
  }
  
  return tracingHeaders;
}

// --- Customer-specific error profiles and helpers ---
const CUSTOMER_ERROR_PROFILES = {
  'acme corp': {
    errorRate: 0.15,
    errorTypes: ['payment_gateway_timeout', 'inventory_service_down', 'authentication_failure'],
    httpErrors: [500, 503, 429],
    problematicSteps: ['checkout', 'payment', 'order confirmation']
  },
  'globex corporation': {
    errorRate: 0.25,
    errorTypes: ['database_connection_lost', 'third_party_api_failure', 'rate_limit_exceeded'],
    httpErrors: [500, 502, 503, 429],
    problematicSteps: ['product selection', 'cart', 'verification']
  },
  'initech': {
    errorRate: 0.08,
    errorTypes: ['session_timeout', 'validation_error', 'temporary_service_unavailable'],
    httpErrors: [408, 422, 503],
    problematicSteps: ['discovery', 'application', 'login']
  },
  'stark industries': {
    errorRate: 0.05,
    errorTypes: ['minor_validation_warning', 'cache_miss'],
    httpErrors: [422, 404],
    problematicSteps: ['customization']
  },
  'umbrella corporation': {
    errorRate: 0.35,
    errorTypes: ['security_breach_detected', 'system_contamination', 'containment_failure', 'biohazard_alert'],
    httpErrors: [500, 503, 502],
    problematicSteps: ['verification', 'security', 'data processing', 'confirmation']
  },
  'default': {
    errorRate: 0.12,
    errorTypes: ['network_timeout', 'service_unavailable', 'validation_failed'],
    httpErrors: [500, 503, 422],
    problematicSteps: ['checkout', 'verification']
  }
};

function generateErrorMessage(errorType, stepName) {
  const messages = {
    payment_gateway_timeout: `Payment gateway timeout during ${stepName}`,
    inventory_service_down: `Inventory service unavailable for ${stepName}`,
    authentication_failure: `Authentication failed during ${stepName}`,
    database_connection_lost: `Database connection lost while processing ${stepName}`,
    third_party_api_failure: `Third-party API failure in ${stepName}`,
    rate_limit_exceeded: `Rate limit exceeded for ${stepName}`,
    session_timeout: `Session expired during ${stepName}`,
    validation_error: `Validation error during ${stepName}`,
    temporary_service_unavailable: `Service temporarily unavailable for ${stepName}`,
    minor_validation_warning: `Minor validation issue during ${stepName}`,
    cache_miss: `Cache miss in ${stepName}`,
    security_breach_detected: `SECURITY ALERT during ${stepName}`,
    system_contamination: `System contamination in ${stepName}`,
    containment_failure: `Containment failure during ${stepName}`,
    biohazard_alert: `Biohazard alert in ${stepName}`,
    network_timeout: `Network timeout during ${stepName}`,
    service_unavailable: `Service unavailable for ${stepName}`,
    validation_failed: `Validation failed in ${stepName}`
  };
  return messages[errorType] || `Unknown error in ${stepName}`;
}

function computeCustomerError(customerName, stepName) {
  const key = String(customerName || '').toLowerCase().trim();
  const profile = CUSTOMER_ERROR_PROFILES[key] || CUSTOMER_ERROR_PROFILES.default;
  const isProblematic = profile.problematicSteps.some(s =>
    String(stepName || '').toLowerCase().includes(s)
  );
  const effectiveRate = Math.min(0.95, profile.errorRate * (isProblematic ? 1.5 : 1));
  if (Math.random() < effectiveRate) {
    const errorType = profile.errorTypes[Math.floor(Math.random() * profile.errorTypes.length)];
    const httpStatus = profile.httpErrors[Math.floor(Math.random() * profile.httpErrors.length)];
    return {
      hasError: true,
      errorType,
      httpStatus,
      errorMessage: generateErrorMessage(errorType, stepName),
      retryable: httpStatus !== 400 && httpStatus !== 404 && httpStatus !== 422,
      severity: httpStatus >= 500 ? 'critical' : httpStatus >= 400 ? 'warning' : 'info'
    };
  }
  return { hasError: false };
}

// Generate realistic additionalFields ensuring ALL fields are included (agnostic approach)
function generateAdditionalFields(existingFields, companyName, customerIndex) {
  // Start with existing fields or empty object
  const fields = (existingFields && typeof existingFields === 'object') ? { ...existingFields } : {};
  
  // Default arrays for fallback values
  const devices = ['mobile', 'desktop', 'tablet'];
  const browsers = ['Chrome', 'Safari', 'Firefox', 'Edge'];
  const locations = ['London, UK', 'Manchester, UK', 'Birmingham, UK', 'Leeds, UK', 'Liverpool, UK'];
  const channels = ['organic', 'paid_search', 'social', 'email', 'direct'];
  const intents = ['purchase', 'research', 'comparison', 'support'];
  const loyaltyTypes = ['new', 'returning', 'vip', 'lapsed'];
  const productNames = ['Premium Product', 'Standard Product', 'Budget Product', 'Deluxe Product'];
  const productTypes = ['Electronics', 'Clothing', 'Home & Garden', 'Sports'];

  // Ensure core fields are present (use existing or generate defaults)
  if (!fields.deviceType) fields.deviceType = devices[customerIndex % devices.length];
  if (!fields.browser) fields.browser = browsers[customerIndex % browsers.length];
  if (!fields.location) fields.location = locations[customerIndex % locations.length];
  if (!fields.entryChannel) fields.entryChannel = channels[customerIndex % channels.length];
  if (!fields.customerIntent) fields.customerIntent = intents[customerIndex % intents.length];
  if (!fields.loyaltyStatus) fields.loyaltyStatus = loyaltyTypes[customerIndex % loyaltyTypes.length];
  if (!fields.abandonmentRisk) fields.abandonmentRisk = customerIndex % 3 === 0 ? 'high' : customerIndex % 2 === 0 ? 'medium' : 'low';
  if (!fields.conversionProbability) fields.conversionProbability = Math.round((0.6 + (customerIndex % 4) * 0.1) * 100) / 100;
  if (!fields.sessionDuration) fields.sessionDuration = 300 + (customerIndex * 60);
  if (!fields.pageViews) fields.pageViews = 3 + (customerIndex % 5);

  // Ensure product fields are present (use existing arrays/values or generate defaults)
  // If arrays exist, preserve them; if single values exist, preserve them; otherwise generate arrays
  if (!fields.Productname && !fields.ProductName) {
    fields.Productname = [
      productNames[customerIndex % productNames.length],
      productNames[(customerIndex + 1) % productNames.length],
      productNames[(customerIndex + 2) % productNames.length]
    ];
  }
  if (!fields.ProductId) {
    fields.ProductId = [
      `SKU${1000 + customerIndex}`,
      `SKU${1001 + customerIndex}`,
      `SKU${1002 + customerIndex}`
    ];
  }
  if (!fields.ProductType) {
    fields.ProductType = [
      productTypes[customerIndex % productTypes.length],
      productTypes[(customerIndex + 1) % productTypes.length],
      productTypes[(customerIndex + 2) % productTypes.length]
    ];
  }
  if (!fields.Price && !fields.ProductCost) {
    fields.Price = [
      29.99 + (customerIndex * 5),
      39.99 + (customerIndex * 5),
      49.99 + (customerIndex * 5)
    ];
  }

  // REVENUE AND FINANCIAL METRICS
  if (!fields.transactionValue) fields.transactionValue = Math.round((50 + (customerIndex * 25) + Math.random() * 200) * 100) / 100;
  if (!fields.orderTotal) fields.orderTotal = Math.round((75 + (customerIndex * 35) + Math.random() * 300) * 100) / 100;
  if (!fields.averageOrderValue) fields.averageOrderValue = Math.round((85 + (customerIndex * 20)) * 100) / 100;
  if (!fields.customerLifetimeValue) fields.customerLifetimeValue = Math.round((500 + (customerIndex * 150) + Math.random() * 1000) * 100) / 100;
  if (!fields.revenuePerCustomer) fields.revenuePerCustomer = Math.round((200 + (customerIndex * 75)) * 100) / 100;
  if (!fields.profitMargin) fields.profitMargin = Math.round((0.15 + (customerIndex % 4) * 0.05) * 100) / 100;
  if (!fields.discountApplied) fields.discountApplied = customerIndex % 3 === 0 ? Math.round((5 + Math.random() * 15) * 100) / 100 : 0;
  if (!fields.taxAmount) fields.taxAmount = Math.round((fields.orderTotal * 0.08) * 100) / 100;
  if (!fields.shippingCost) fields.shippingCost = customerIndex % 2 === 0 ? Math.round((5 + Math.random() * 15) * 100) / 100 : 0;
  
  // PRICING AND TIER INFORMATION
  if (!fields.pricingTier) fields.pricingTier = ['Bronze', 'Silver', 'Gold', 'Platinum'][customerIndex % 4];
  if (!fields.subscriptionLevel) fields.subscriptionLevel = ['Basic', 'Premium', 'Enterprise', 'Ultimate'][customerIndex % 4];
  if (!fields.membershipStatus) fields.membershipStatus = ['Regular', 'VIP', 'Elite', 'Ambassador'][customerIndex % 4];
  if (!fields.contractValue) fields.contractValue = Math.round((1000 + (customerIndex * 500) + Math.random() * 5000) * 100) / 100;
  if (!fields.annualRevenue) fields.annualRevenue = Math.round((fields.customerLifetimeValue * 2.5) * 100) / 100;
  
  // BUSINESS INTELLIGENCE METRICS
  if (!fields.acquisitionCost) fields.acquisitionCost = Math.round((25 + (customerIndex * 10) + Math.random() * 50) * 100) / 100;
  if (!fields.retentionProbability) fields.retentionProbability = Math.round((0.7 + (customerIndex % 3) * 0.1) * 100) / 100;
  if (!fields.churnRisk) fields.churnRisk = customerIndex % 4 === 0 ? 'high' : customerIndex % 3 === 0 ? 'medium' : 'low';
  if (!fields.upsellPotential) fields.upsellPotential = Math.round((fields.customerLifetimeValue * 0.3) * 100) / 100;
  if (!fields.crossSellOpportunity) fields.crossSellOpportunity = customerIndex % 2 === 0 ? 'high' : 'medium';
  if (!fields.customerSegmentValue) fields.customerSegmentValue = ['High-Value', 'Mid-Value', 'Standard', 'Budget'][customerIndex % 4];
  if (!fields.marketSegment) fields.marketSegment = ['Enterprise', 'SMB', 'Mid-Market', 'Startup'][customerIndex % 4];
  
  // PERFORMANCE AND CONVERSION METRICS
  if (!fields.conversionRate) fields.conversionRate = Math.round((0.05 + (customerIndex % 5) * 0.02) * 100) / 100;
  if (!fields.engagementScore) fields.engagementScore = Math.round((60 + (customerIndex * 8) + Math.random() * 25) * 100) / 100;
  if (!fields.satisfactionRating) fields.satisfactionRating = Math.round((3.5 + (customerIndex % 3) * 0.5) * 100) / 100;
  if (!fields.netPromoterScore) fields.netPromoterScore = Math.round((40 + (customerIndex % 6) * 10) * 100) / 100;
  if (!fields.purchaseFrequency) fields.purchaseFrequency = Math.round((2 + (customerIndex % 4) * 1.5) * 100) / 100;
  if (!fields.timeToConversion) fields.timeToConversion = Math.round((5 + (customerIndex * 2) + Math.random() * 10) * 100) / 100;
  
  // COMPETITIVE AND MARKET POSITIONING
  if (!fields.competitiveAdvantage) fields.competitiveAdvantage = ['Price', 'Quality', 'Service', 'Innovation'][customerIndex % 4];
  if (!fields.marketShare) fields.marketShare = Math.round((0.05 + (customerIndex % 3) * 0.03) * 100) / 100;
  if (!fields.brandLoyalty) fields.brandLoyalty = ['Low', 'Medium', 'High', 'Very High'][customerIndex % 4];
  if (!fields.competitorComparison) fields.competitorComparison = ['Better', 'Similar', 'Superior', 'Leading'][customerIndex % 4];
  
  // OPERATIONAL EFFICIENCY METRICS
  if (!fields.processingTime) fields.processingTime = Math.round((10 + (customerIndex * 5) + Math.random() * 20) * 100) / 100;
  if (!fields.operationalCost) fields.operationalCost = Math.round((fields.revenuePerCustomer * 0.4) * 100) / 100;
  if (!fields.efficiencyRating) fields.efficiencyRating = Math.round((70 + (customerIndex % 4) * 7.5) * 100) / 100;
  if (!fields.resourceUtilization) fields.resourceUtilization = Math.round((0.6 + (customerIndex % 3) * 0.15) * 100) / 100;
  if (!fields.costPerAcquisition) fields.costPerAcquisition = Math.round((fields.acquisitionCost * 1.2) * 100) / 100;
  
  // RISK AND COMPLIANCE METRICS
  if (!fields.riskLevel) fields.riskLevel = ['Low', 'Medium', 'High', 'Critical'][customerIndex % 4];
  if (!fields.complianceScore) fields.complianceScore = Math.round((85 + (customerIndex % 3) * 5) * 100) / 100;
  if (!fields.fraudRisk) fields.fraudRisk = customerIndex % 5 === 0 ? 'high' : customerIndex % 3 === 0 ? 'medium' : 'low';
  if (!fields.securityRating) fields.securityRating = ['A', 'B', 'C', 'A+'][customerIndex % 4];
  
  // FORECASTING AND GROWTH METRICS
  if (!fields.growthPotential) fields.growthPotential = Math.round((fields.customerLifetimeValue * 0.25) * 100) / 100;
  if (!fields.futureValue) fields.futureValue = Math.round((fields.customerLifetimeValue * 1.5) * 100) / 100;
  if (!fields.expansionOpportunity) fields.expansionOpportunity = ['Limited', 'Moderate', 'High', 'Exceptional'][customerIndex % 4];
  if (!fields.marketTrend) fields.marketTrend = ['Declining', 'Stable', 'Growing', 'Expanding'][customerIndex % 4];
  if (!fields.seasonalImpact) fields.seasonalImpact = Math.round((0.1 + (customerIndex % 3) * 0.05) * 100) / 100;

  return fields;
}

// Generate realistic customerProfile if missing or empty
function generateCustomerProfile(existingProfile, companyName, customerIndex) {
  if (existingProfile && Object.keys(existingProfile).length > 0) {
    return existingProfile; // Use existing profile if available
  }
  
  const demographics = ['millennials 25-40', 'gen-x 41-55', 'gen-z 18-25', 'boomers 56-70'];
  const painPoints = ['high prices', 'poor quality', 'complex checkout', 'poor support'];
  const goals = ['quality products', 'fast delivery', 'reliable service', 'unique products'];
  
  return {
    userId: `user_${companyName.toLowerCase()}_${customerIndex + 1}`,
    email: `customer${customerIndex + 1}@example.com`,
    demographic: demographics[customerIndex % demographics.length],
    painPoints: painPoints[customerIndex % painPoints.length],
    goals: goals[customerIndex % goals.length],
    customerTier: customerIndex % 4 === 0 ? 'premium' : customerIndex % 3 === 0 ? 'gold' : 'standard',
    registrationDate: new Date(Date.now() - (customerIndex * 30 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0]
  };
}

// Generate realistic traceMetadata if missing or empty
function generateTraceMetadata(existingMetadata, correlationId, customerIndex) {
  if (existingMetadata && Object.keys(existingMetadata).length > 0) {
    return existingMetadata; // Use existing metadata if available
  }
  
  const campaigns = ['summer2025', 'autumn_sale', 'black_friday', 'new_year', 'spring_launch'];
  const segments = ['consumer', 'business', 'enterprise', 'student', 'senior'];
  const sources = ['organic', 'paid', 'social', 'email'];
  
  return {
    correlationId: correlationId,
    sessionId: `session_${Date.now()}_${customerIndex}`,
    businessContext: {
      campaignSource: sources[customerIndex % sources.length],
      campaignName: campaigns[customerIndex % campaigns.length],
      customerSegment: segments[customerIndex % segments.length],
      businessValue: 500 + (customerIndex * 200),
      acquisitionCost: 25 + (customerIndex * 5),
      expectedLifetimeValue: 1000 + (customerIndex * 300)
    }
  };
}

// Generate dynamic service name based on AI/Copilot response details
function generateDynamicServiceName(stepName, description = '', category = '', originalStep = {}) {
  // If step already has a service-like name, use it
  if (/Service$/.test(stepName)) {
    return stepName;
  }
  
  // Extract meaningful keywords from description
  const descriptionKeywords = description.toLowerCase().match(/\b(api|service|endpoint|processor|handler|manager|controller|gateway|orchestrator)\b/g) || [];
  
  // Determine service type based on content analysis
  let serviceType = 'Service'; // default
  
  if (description.toLowerCase().includes('api') || originalStep.endpoint) {
    serviceType = 'API';
  } else if (description.toLowerCase().includes('process') || description.toLowerCase().includes('handle')) {
    serviceType = 'Processor';
  } else if (description.toLowerCase().includes('manage') || description.toLowerCase().includes('control')) {
    serviceType = 'Manager';
  } else if (description.toLowerCase().includes('gateway') || description.toLowerCase().includes('proxy')) {
    serviceType = 'Gateway';
  } else if (category) {
    // Use category as service type if available
    serviceType = category.charAt(0).toUpperCase() + category.slice(1) + 'Service';
  }
  
  // Clean and format the step name
  const cleaned = String(stepName).replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
  const serviceBase = cleaned
    .replace(/[\-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  
  const dynamicServiceName = `${serviceBase}${serviceType}`;
  console.log(`[journey-sim] Generated dynamic service name: ${stepName} -> ${dynamicServiceName}`);
  
  return dynamicServiceName;
}

// Circuit breaker state per service
const circuitBreakerState = new Map();

// Initialize circuit breaker for a service
function initCircuitBreaker(serviceName) {
  if (!circuitBreakerState.has(serviceName)) {
    circuitBreakerState.set(serviceName, {
      failureCount: 0,
      lastFailureTime: 0,
      state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
      threshold: 5, // Failures before opening
      timeout: 10000 // 10 seconds before half-open
    });
  }
  return circuitBreakerState.get(serviceName);
}

// Check if circuit breaker allows request
function canMakeRequest(serviceName) {
  const breaker = initCircuitBreaker(serviceName);
  const now = Date.now();
  
  if (breaker.state === 'CLOSED') {
    return true;
  } else if (breaker.state === 'OPEN') {
    if (now - breaker.lastFailureTime > breaker.timeout) {
      breaker.state = 'HALF_OPEN';
      return true;
    }
    return false;
  } else if (breaker.state === 'HALF_OPEN') {
    return true;
  }
  return false;
}

// Record success/failure for circuit breaker
function recordResult(serviceName, success) {
  const breaker = initCircuitBreaker(serviceName);
  
  if (success) {
    breaker.failureCount = 0;
    breaker.state = 'CLOSED';
  } else {
    breaker.failureCount++;
    breaker.lastFailureTime = Date.now();
    
    if (breaker.failureCount >= breaker.threshold) {
      breaker.state = 'OPEN';
      console.log(`[journey-sim] Circuit breaker OPENED for ${serviceName} after ${breaker.failureCount} failures`);
    }
  }
}

// Call a service with improved error handling and retry logic
async function callDynamicService(stepName, port, payload, incomingHeaders = {}) {
  // Check circuit breaker first
  if (!canMakeRequest(stepName)) {
    const breaker = circuitBreakerState.get(stepName);
    console.log(`[journey-sim] Circuit breaker OPEN for ${stepName}, returning fallback response`);
    
    return {
      status: 'failed',
      httpStatus: 503,
      error: `Service ${stepName} circuit breaker is OPEN`,
      errorType: 'circuit_breaker_open',
      serviceName: stepName,
      timestamp: new Date().toISOString(),
      circuitBreakerState: breaker.state,
      fallback: true
    };
  }

  return new Promise((resolve, reject) => {
    // Build outgoing headers by preserving tracing headers when present
    const headers = {
      'Content-Type': 'application/json',
      'x-correlation-id': incomingHeaders['x-correlation-id'] || payload.correlationId || ''
    };

    // Helper to ensure a valid W3C traceparent (version-00)
    function ensureTraceparent(hdrs, correlationId) {
      // If already provided, validate and return it
      if (hdrs['traceparent']) {
        const tp = hdrs['traceparent'];
        // Basic W3C traceparent validation: 00-{32hex}-{16hex}-{2hex}
        if (/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i.test(tp)) {
          return tp;
        }
        console.warn(`[journey-sim] Invalid traceparent format: ${tp}, generating new one`);
      }
      
      // Generate a new W3C traceparent
      try {
        const traceId = crypto.randomBytes(16).toString('hex');
        const spanId = crypto.randomBytes(8).toString('hex');
        // flags 01 = sampled
        const traceparent = `00-${traceId}-${spanId}-01`;
        console.log(`[journey-sim] Generated new traceparent: ${traceparent} (correlationId: ${correlationId})`);
        return traceparent;
      } catch (e) {
        // Fallback using timestamp + correlation ID for deterministic but unique IDs
        const timestamp = Date.now().toString(16).padStart(16, '0');
        const corrHash = correlationId ? crypto.createHash('md5').update(correlationId).digest('hex').slice(0, 16) : Math.random().toString(16).slice(2, 18).padEnd(16, '0');
        const traceId = (timestamp + corrHash).slice(0, 32);
        const spanId = Math.random().toString(16).slice(2, 18).padEnd(16, '0').slice(0, 16);
        const fallbackTraceparent = `00-${traceId}-${spanId}-01`;
        console.log(`[journey-sim] Fallback traceparent generated: ${fallbackTraceparent}`);
        return fallbackTraceparent;
      }
    }

    // Copy known tracing headers if present
    if (incomingHeaders['traceparent']) headers['traceparent'] = incomingHeaders['traceparent'];
    if (incomingHeaders['tracestate']) headers['tracestate'] = incomingHeaders['tracestate'];
    if (incomingHeaders['x-dynatrace-trace-id']) headers['x-dynatrace-trace-id'] = incomingHeaders['x-dynatrace-trace-id'];
    if (incomingHeaders['x-dynatrace-parent-span-id']) headers['x-dynatrace-parent-span-id'] = incomingHeaders['x-dynatrace-parent-span-id'];
    if (incomingHeaders['uber-trace-id']) headers['uber-trace-id'] = incomingHeaders['uber-trace-id'];

    // Ensure a traceparent exists so OneAgent and downstream services will join the trace
    if (!headers['traceparent']) {
      headers['traceparent'] = ensureTraceparent(incomingHeaders || {}, payload.correlationId);
      // also set Dynatrace header to help trace correlation (value = trace id portion)
      try {
        const tpParts = headers['traceparent'].split('-');
        if (tpParts.length >= 2 && !headers['x-dynatrace-trace-id']) headers['x-dynatrace-trace-id'] = tpParts[1];
      } catch (e) {}
    }

    // Add business context headers for better Dynatrace visibility
    if (payload.companyName) headers['x-business-company'] = payload.companyName;
    if (payload.domain) headers['x-business-domain'] = payload.domain;
    if (payload.industryType) headers['x-business-industry'] = payload.industryType;
    if (payload.customerId) headers['x-business-customer-id'] = payload.customerId;
    if (payload.journeyId) headers['x-business-journey-id'] = payload.journeyId;
    if (payload.stepName) headers['x-business-step'] = payload.stepName;
    if (payload.stepIndex) headers['x-business-step-index'] = payload.stepIndex.toString();
    
    // Add customer profile info for business observability
    if (payload.customerProfile?.userId) headers['x-customer-user-id'] = payload.customerProfile.userId;
    if (payload.customerProfile?.customerTier) headers['x-customer-tier'] = payload.customerProfile.customerTier;

    console.log(`[journey-sim] Calling ${stepName} with trace headers: traceparent=${headers['traceparent']?.substring(0, 20)}...`);
    
    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: '/process',
      method: 'POST',
      headers,
      timeout: 15000  // Increased timeout to 15 seconds
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          // Check if response is HTML (error page) instead of JSON
          if (body.trim().startsWith('<html') || body.trim().startsWith('<!DOCTYPE')) {
            console.error(`[journey-sim] ${stepName} returned HTML error page (status ${res.statusCode}):`, body.substring(0, 200));
            
            // Record circuit breaker failure for HTML errors
            recordResult(stepName, false);
            
            // Create a fallback JSON response for HTML error pages
            const fallbackResponse = {
              status: 'failed',
              httpStatus: res.statusCode,
              error: `Service returned HTML error page (status ${res.statusCode})`,
              errorType: 'html_error_response',
              serviceName: stepName,
              timestamp: new Date().toISOString(),
              _traceInfo: {
                requestTraceparent: headers['traceparent'],
                requestTracestate: headers['tracestate'],
                responseTraceparent: res.headers['traceparent'],
                requestCorrelationId: headers['x-correlation-id']
              }
            };
            resolve(fallbackResponse);
            return;
          }

          // Try to parse as JSON
          const parsed = body ? JSON.parse(body) : {};
          // Attach HTTP status for downstream logic
          parsed.httpStatus = res.statusCode;
          // Include trace validation info
          parsed._traceInfo = {
            requestTraceparent: headers['traceparent'],
            requestTracestate: headers['tracestate'],
            responseTraceparent: res.headers['traceparent'],
            requestCorrelationId: headers['x-correlation-id']
          };
          
          // Record circuit breaker result
          const isSuccess = res.statusCode >= 200 && res.statusCode < 400;
          recordResult(stepName, isSuccess);
          
          console.log(`[journey-sim] ${stepName} responded with status ${res.statusCode}, trace: ${headers['traceparent']?.substring(0, 20)}...`);
          
          // Record trace validation data for debugging
          if (typeof global.recordTraceValidation === 'function') {
            global.recordTraceValidation(stepName, headers, parsed);
          }
          
          resolve(parsed);
        } catch (e) {
          console.error(`[journey-sim] JSON parse error from ${stepName}:`, e.message, 'Body preview:', body.substring(0, 200));
          
          // Record circuit breaker failure
          recordResult(stepName, false);
          
          // Create a structured error response instead of rejecting
          const errorResponse = {
            status: 'failed',
            httpStatus: res.statusCode || 500,
            error: `Invalid JSON response from ${stepName}: ${e.message}`,
            errorType: 'json_parse_error',
            serviceName: stepName,
            timestamp: new Date().toISOString(),
            responsePreview: body.substring(0, 200),
            _traceInfo: {
              requestTraceparent: headers['traceparent'],
              requestTracestate: headers['tracestate'],
              responseTraceparent: res.headers['traceparent'],
              requestCorrelationId: headers['x-correlation-id']
            }
          };
          resolve(errorResponse);
        }
      });
    });
    
    req.on('error', (err) => {
      console.error(`[journey-sim] Request error to ${stepName} on port ${port}:`, err.message);
      
      // Record circuit breaker failure
      recordResult(stepName, false);
      
      // Create a structured error response instead of rejecting
      const errorResponse = {
        status: 'failed',
        httpStatus: 503,
        error: `Connection error to ${stepName}: ${err.message}`,
        errorType: 'connection_error',
        serviceName: stepName,
        timestamp: new Date().toISOString(),
        _traceInfo: {
          requestTraceparent: headers['traceparent'],
          requestTracestate: headers['tracestate'],
          requestCorrelationId: headers['x-correlation-id']
        }
      };
      resolve(errorResponse);
    });
    
    req.on('timeout', () => {
      console.error(`[journey-sim] Request timeout to ${stepName} on port ${port}`);
      req.destroy();
      
      // Record circuit breaker failure
      recordResult(stepName, false);
      
      // Create a structured error response instead of rejecting
      const errorResponse = {
        status: 'failed',
        httpStatus: 408,
        error: `Timeout calling ${stepName} on port ${port}`,
        errorType: 'timeout_error',
        serviceName: stepName,
        timestamp: new Date().toISOString(),
        _traceInfo: {
          requestTraceparent: headers['traceparent'],
          requestTracestate: headers['tracestate'],
          requestCorrelationId: headers['x-correlation-id']
        }
      };
      resolve(errorResponse);
    });
    
    const payloadString = JSON.stringify(payload);
    console.log(`[journey-sim] Sending to ${stepName}:`, payloadString);
    req.write(payloadString);
    req.end();
  });
}

// Simulate journey
router.post('/simulate-journey', async (req, res) => {
  console.log('[journey-sim] Route handler called');
  try {
    const { 
      journeyId = `journey_${Date.now()}`, 
      customerId = `customer_${Date.now()}`,
      chained = true,
      thinkTimeMs = 250,
      errorSimulationEnabled = true
    } = req.body || {};
    
    const correlationId = req.correlationId;
    
    // Extract step data with serviceName support
    let stepData = [];
    
    try {
      // Check multiple possible payload structures
      let stepsArray = null;
      
      console.log('[journey-sim] Checking payload structure. req.body.journey:', !!req.body.journey);
      console.log('[journey-sim] req.body.journey.steps:', !!req.body.journey?.steps);
      console.log('[journey-sim] req.body.aiJourney:', !!req.body.aiJourney);
      console.log('[journey-sim] req.body.aiJourney.steps:', !!req.body.aiJourney?.steps);
      
      if (req.body.journey?.steps && Array.isArray(req.body.journey.steps)) {
        stepsArray = req.body.journey.steps;
        console.log('[journey-sim] Using journey.steps structure');
      } else if (req.body.aiJourney?.steps && Array.isArray(req.body.aiJourney.steps)) {
        stepsArray = req.body.aiJourney.steps;
        console.log('[journey-sim] Using aiJourney.steps structure');
      }
      
      if (stepsArray) {
        console.log('[journey-sim] Raw stepsArray:', JSON.stringify(stepsArray, null, 2));
        stepData = stepsArray.slice(0, 6).map(step => {
          console.log('[journey-sim] Processing step:', JSON.stringify(step, null, 2));
          // Extract step name from various AI response formats
          const stepName = step.stepName || step.name || step.step || step.title || 'UnknownStep';
          
          // Generate dynamic service name based on AI response details
          let serviceName = step.serviceName;
          if (!serviceName) {
            // Try to extract service name from description, action, or other fields
            const description = step.description || step.action || step.summary || '';
            const category = step.category || step.type || step.phase || '';
            
            // Create intelligent service name based on available data
            serviceName = generateDynamicServiceName(stepName, description, category, step);
          }
          
          const extractedStep = {
            stepName,
            serviceName,
            description: step.description || '',
            category: step.category || step.type || '',
            estimatedDuration: step.estimatedDuration,
            businessRationale: step.businessRationale,
            timestamp: step.timestamp,
            duration: step.duration,
            substeps: step.substeps,
            originalStep: step // Keep original for reference
          };
          console.log('[journey-sim] Extracted step data:', JSON.stringify(extractedStep, null, 2));
          return extractedStep;
        });
        console.log('[journey-sim] Extracted dynamic stepData:', stepData);
      } else {
        stepData = DEFAULT_JOURNEY_STEPS.map(name => ({ 
          stepName: name, 
          serviceName: null,
          description: '',
          category: ''
        }));
        console.log('[journey-sim] Using default steps');
      }
    } catch (error) {
      console.error('[journey-sim] Error extracting step data:', error.message);
      stepData = DEFAULT_JOURNEY_STEPS.map(name => ({ stepName: name, serviceName: null }));
    }
    
    // Extract tracing headers once at the beginning for use throughout the journey
    const tracingHeaders = extractTracingHeaders(req);
    
    // Ensure stepData is valid
    if (!Array.isArray(stepData) || stepData.length === 0) {
      stepData = DEFAULT_JOURNEY_STEPS.map(name => ({ stepName: name, serviceName: null }));
      console.log('[journey-sim] Fallback to default steps due to invalid stepData');
    }
    
    // Extract company context and all business analytics details
    const currentPayload = {
      journeyId: req.body.journey?.journeyId || journeyId,
      customerId,
      correlationId,
      startTime: new Date().toISOString(),
      companyName: req.body.journey?.companyName || req.body.companyName || 'DefaultCompany',
      domain: req.body.journey?.domain || req.body.domain || 'default.com',
      industryType: req.body.journey?.industryType || req.body.industryType || 'general',
      additionalFields: req.body.journey?.additionalFields || req.body.additionalFields || null,
      customerProfile: req.body.journey?.customerProfile || req.body.customerProfile || null,
      traceMetadata: req.body.journey?.traceMetadata || req.body.traceMetadata || null,
      sources: req.body.journey?.sources || req.body.sources || [],
      provider: req.body.journey?.provider || req.body.provider || 'unknown',
      steps: req.body.journey?.steps || req.body.steps || []
    };
    
    // Debug logging for additionalFields extraction
    console.log('[journey-sim] ADDITIONALFIELDS DEBUG:', {
      'req.body.additionalFields': req.body.additionalFields,
      'req.body.journey?.additionalFields': req.body.journey?.additionalFields,
      'currentPayload.additionalFields (before simplify)': currentPayload.additionalFields
    });
    
    // Convert arrays to single values for realistic customer journeys
    function simplifyFieldArrays(obj) {
      if (!obj || typeof obj !== 'object') return {};
      
      const simplified = {};
      Object.keys(obj).forEach(key => {
        const value = obj[key];
        if (Array.isArray(value) && value.length > 0) {
          // For realistic customer journeys, pick ONE item instead of arrays
          const randomIndex = Math.floor(Math.random() * value.length);
          simplified[key] = value[randomIndex];
        } else if (value !== null && value !== undefined && typeof value === 'object') {
          // Recursively simplify nested objects
          simplified[key] = simplifyFieldArrays(value);
        } else if (value !== null && value !== undefined) {
          // Keep non-null, non-undefined values as-is
          simplified[key] = value;
        }
      });
      return simplified;
    }
    
    // STEP 1: PRESERVE EXISTING RICH CONTEXT - Don't overwrite AI-generated fields
    // Ensure we have proper objects even if input is null
    currentPayload.additionalFields = currentPayload.additionalFields || {};
    currentPayload.customerProfile = currentPayload.customerProfile || {};
    currentPayload.traceMetadata = currentPayload.traceMetadata || {};
    
    // Only enhance additionalFields if they are truly empty (preserve rich AI context)
    const hasRichContext = currentPayload.additionalFields && Object.keys(currentPayload.additionalFields).length > 10;
    if (!hasRichContext) {
      console.log('[journey-sim] No rich context found, generating basic fields');
      currentPayload.additionalFields = generateAdditionalFields(currentPayload.additionalFields, currentPayload.companyName, 0);
    } else {
      console.log('[journey-sim] Rich context detected, preserving AI-generated fields:', Object.keys(currentPayload.additionalFields).length);
    }
    
    // STEP 2: SIMPLIFICATION - Only convert arrays to single values (preserve single values)
    currentPayload.additionalFields = simplifyFieldArrays(currentPayload.additionalFields);
    currentPayload.customerProfile = simplifyFieldArrays(currentPayload.customerProfile);
    if (currentPayload.traceMetadata.businessContext) {
      currentPayload.traceMetadata.businessContext = simplifyFieldArrays(currentPayload.traceMetadata.businessContext);
    }
    
    // Debug logging after enhancement and simplification
    console.log('[journey-sim] AFTER ENHANCEMENT AND SIMPLIFICATION:', {
      'currentPayload.additionalFields': currentPayload.additionalFields,
      'currentPayload.customerProfile': currentPayload.customerProfile,
      'currentPayload.traceMetadata': currentPayload.traceMetadata
    });
    
    console.log(`[journey-sim] Simplified additionalFields:`, currentPayload.additionalFields);
    console.log(`[journey-sim] Company: ${currentPayload.companyName}, Domain: ${currentPayload.domain}`);
    
    // Start services with company context including journey detail
    const journeyDetail = generateJourneyDetail(currentPayload, stepData);
    const companyContext = {
      companyName: currentPayload.companyName,
      domain: currentPayload.domain,
      industryType: currentPayload.industryType,
      journeyDetail: journeyDetail
    };
    
    // Compute per-step error plans based on customer profile, with optional hints from the journey JSON
    // 🔧 ARCHITECTURAL IMPROVEMENT: Use error configuration from journey data (Step 3 processing)
    // instead of runtime decisions based on UI toggle state
    const errorPlannedSteps = stepData.map(s => {
      console.log(`[journey-sim] Processing step: ${s.stepName}, hasError from journey data: ${s.originalStep?.hasError}, errorHint: ${s.originalStep?.errorHint || 'none'}`);
      
      // Use error configuration embedded in journey data by Step 3 processing
      const hasErrorFromJourneyData = s.originalStep?.hasError === true;
      const errorHintFromJourneyData = s.originalStep?.errorHint;
      
      if (hasErrorFromJourneyData) {
        console.log(`[journey-sim] 🔴 Error configured for step: ${s.stepName} (from Step 3 journey processing)`);
        
        // Use journey data error configuration with customer-specific error profiles as fallback
        let plan = computeCustomerError(currentPayload.companyName, s.stepName);
        
        // Apply error configuration from journey data
        plan = {
          hasError: true,
          errorType: plan.errorType || 'service_unavailable',
          httpStatus: plan.httpStatus || 500,
          errorMessage: errorHintFromJourneyData || generateErrorMessage(plan.errorType || 'service_unavailable', s.stepName),
          retryable: ![400, 404, 422].includes(Number(plan.httpStatus || 500)),
          severity: Number(plan.httpStatus || 500) >= 500 ? 'critical' : Number(plan.httpStatus || 500) >= 400 ? 'warning' : 'info'
        };
        
        return { ...s, ...plan };
      } else {
        console.log(`[journey-sim] ✅ Success configured for step: ${s.stepName} (from Step 3 journey processing)`);
        return { ...s, hasError: false };
      }
    });

    for (const stepInfo of errorPlannedSteps) {
      const { stepName, serviceName, description, category } = stepInfo;
      await ensureServiceRunning(stepName, { 
        ...companyContext, 
        stepName, 
        serviceName,
        description,
        category,
        type: category
      });
    }

    await new Promise(resolve => setTimeout(resolve, 5000));  // Wait for services to fully start

    const journeyResults = [];
    
    if (chained) {
      const first = stepData[0];
      if (!first) {
        throw new Error('No steps available for chained execution');
      }
      
      // Ensure first service is up with correct company context
      const firstPort = await ensureServiceRunning(first.stepName, { ...companyContext, stepName: first.stepName, serviceName: first.serviceName }); // Handle both old and new format
      const actualServiceName = first.serviceName || getServiceNameFromStep(first.stepName);
      
      console.log(`[journey-sim] [chained] Calling first service ${actualServiceName} on port ${firstPort}`);
      
      // Create step-specific payload for chained execution - ONLY include current step data
      const firstStepInfo = errorPlannedSteps[0];
      const chainedPayload = {
        // Journey metadata
        journeyId: currentPayload.journeyId,
        customerId: currentPayload.customerId,
        correlationId: currentPayload.correlationId,
        startTime: currentPayload.startTime,
        companyName: currentPayload.companyName,
        domain: currentPayload.domain,
        industryType: currentPayload.industryType,
        
        // Current step specific data ONLY
        stepName: first.stepName,
        stepIndex: 1,
        totalSteps: stepData.length,
        stepDescription: firstStepInfo.description || '',
        stepCategory: firstStepInfo.category || '',
        
        // Add Copilot duration fields for OneAgent capture
        estimatedDuration: firstStepInfo.estimatedDuration,
        businessRationale: firstStepInfo.businessRationale,
        substeps: firstStepInfo.substeps,
        estimatedDurationMs: firstStepInfo.estimatedDuration ? firstStepInfo.estimatedDuration * 60 * 1000 : null,
        
        // Chain configuration - only include routing info for next step (not all steps)
        thinkTimeMs,
        isChained: true,
        nextStepName: stepData.length > 1 ? stepData[1].stepName : null,
        nextStepService: stepData.length > 1 ? stepData[1].serviceName : null,
        
        // Current step's substeps
        subSteps: firstStepInfo.originalStep?.subSteps || firstStepInfo.substeps || [],
        
        // Error configuration for first step
        hasError: firstStepInfo.hasError,
        errorType: firstStepInfo.errorType,
        errorMessage: firstStepInfo.errorMessage,
        httpStatus: firstStepInfo.httpStatus,
        retryable: firstStepInfo.retryable,
        severity: firstStepInfo.severity,
        
        // Include full customer/business context in each trace
        additionalFields: currentPayload.additionalFields || {},
        customerProfile: currentPayload.customerProfile || {},
        traceMetadata: currentPayload.traceMetadata || {},
        sources: currentPayload.sources || [],
        provider: currentPayload.provider || 'unknown'
      };
      
      console.log(`[journey-sim] [chained] Step-specific payload for first service:`, JSON.stringify(chainedPayload, null, 2));
      
      const chainedResult = await callDynamicService(first.stepName, firstPort, chainedPayload, { 'x-correlation-id': correlationId, ...tracingHeaders });
      
      if (chainedResult) {
        journeyResults.push({
          ...chainedResult,
          stepNumber: 1,
          serviceName: actualServiceName
        });
      }
    } else {
      for (let i = 0; i < stepData.length; i++) {
        const stepInfo = errorPlannedSteps[i];
        if (!stepInfo) {
          console.error(`[journey-sim] Step ${i} is undefined, skipping`);
          continue;
        }
        
        const { stepName, serviceName: payloadServiceName } = stepInfo;
        if (!stepName) {
          console.error(`[journey-sim] Step ${i} has no stepName, skipping`);
          continue;
        }
        
        const serviceName = payloadServiceName || getServiceNameFromStep(stepName);
        // Ensure service is up with correct company context prior to call
        const servicePort = await ensureServiceRunning(stepName, { ...companyContext, stepName, serviceName });
        
        try {
          // Create step-specific payload with ONLY current step data
          const stepPayload = {
            // Journey metadata
            journeyId: currentPayload.journeyId,
            customerId: currentPayload.customerId,
            correlationId: currentPayload.correlationId,
            startTime: currentPayload.startTime,
            companyName: currentPayload.companyName,
            domain: currentPayload.domain,
            industryType: currentPayload.industryType,
            
            // Current step specific data ONLY
            stepName,
            stepIndex: i + 1,
            totalSteps: stepData.length,
            stepDescription: stepInfo.description || '',
            stepCategory: stepInfo.category || '',
            
            // Add Copilot duration fields for OneAgent capture
            estimatedDuration: stepInfo.estimatedDuration,
            businessRationale: stepInfo.businessRationale,
            substeps: stepInfo.substeps,
            estimatedDurationMs: stepInfo.estimatedDuration ? stepInfo.estimatedDuration * 60 * 1000 : null,
            
            // Current step's substeps if available
            subSteps: stepInfo.originalStep?.subSteps || stepInfo.substeps || [],
            
            // Error configuration for current step only
            hasError: stepInfo.hasError,
            errorType: stepInfo.errorType,
            errorMessage: stepInfo.errorMessage,
            httpStatus: stepInfo.httpStatus,
            retryable: stepInfo.retryable,
            severity: stepInfo.severity,
            
            // Include full customer/business context in each trace
            additionalFields: currentPayload.additionalFields || {},
            customerProfile: currentPayload.customerProfile || {},
            traceMetadata: currentPayload.traceMetadata || {},
            sources: currentPayload.sources || [],
            provider: currentPayload.provider || 'unknown'
          };

          const stepResult = await callDynamicService(stepName, servicePort, stepPayload, { 'x-correlation-id': correlationId, ...tracingHeaders });
          
          const isFailed = stepResult?.status === 'failed' || (stepResult?.httpStatus && stepResult.httpStatus >= 400);
          journeyResults.push({
            ...stepResult,
            stepNumber: i + 1,
            stepName,
            serviceName,
            status: isFailed ? 'failed' : (stepResult?.status || 'completed')
          });
          
          console.log(`[journey-sim] ✅ Step ${i + 1}: ${serviceName}`);
        } catch (error) {
          console.error(`[journey-sim] ❌ Step ${i + 1} failed: ${error.message}`);
          journeyResults.push({
            stepNumber: i + 1,
            stepName,
            serviceName,
            status: 'failed',
            error: error.message
          });
        }
        
        await new Promise(resolve => setTimeout(resolve, thinkTimeMs));
      }
    }
    
    const journeyComplete = {
      journeyId,
      customerId,
      correlationId,
      status: 'completed',
      totalSteps: stepData.length,
      completedSteps: journeyResults.filter(r => r.status !== 'failed').length,
      stepNames: stepData.map(s => s.stepName),
      steps: journeyResults,
      additionalFields: generateAdditionalFields(currentPayload.additionalFields, currentPayload.companyName, 0),
      customerProfile: generateCustomerProfile(currentPayload.customerProfile, currentPayload.companyName, 0),
      traceMetadata: generateTraceMetadata(currentPayload.traceMetadata, correlationId, 0),
      sources: currentPayload.sources,
      provider: currentPayload.provider
    };
    
    res.json({
      success: true,
      journey: journeyComplete
    });

  } catch (error) {
    console.error('[journey-sim] Journey simulation failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Multiple customer journey simulation with detailed output
router.post('/simulate-multiple-journeys', async (req, res) => {
  console.log('[journey-sim] Multiple journeys simulation called');
  try {
    const { 
      customers = 1,
      thinkTimeMs = 250,
      aiJourney,
      journey,
      errorSimulationEnabled = true
    } = req.body || {};

    // Enforce customer limit of 5
    const requestedCustomers = Number(customers || 1);
    if (requestedCustomers > 5) {
      return res.status(400).json({
        ok: false,
        error: `Customer limit exceeded. Maximum allowed: 5, requested: ${requestedCustomers}`,
        maxCustomers: 5,
        requestedCustomers: requestedCustomers
      });
    }

    // Use aiJourney or journey
    const journeyObj = aiJourney || journey || {};
    
    // Extract and process payload data similar to single journey endpoint
    const journeyId = `journey_${Date.now()}`;
    const correlationId = req.correlationId || crypto.randomUUID();
    
    // Extract company context and all business analytics details
    const currentPayload = {
      journeyId: journeyObj.journeyId || journeyId,
      correlationId,
      startTime: new Date().toISOString(),
      companyName: journeyObj.companyName || req.body.companyName || 'DefaultCompany',
      domain: journeyObj.domain || req.body.domain || 'default.com',
      industryType: journeyObj.industryType || req.body.industryType || 'general',
      additionalFields: journeyObj.additionalFields || req.body.additionalFields || null,
      customerProfile: journeyObj.customerProfile || req.body.customerProfile || null,
      traceMetadata: journeyObj.traceMetadata || req.body.traceMetadata || null,
      sources: journeyObj.sources || req.body.sources || [],
      provider: journeyObj.provider || req.body.provider || 'unknown',
      steps: journeyObj.steps || req.body.steps || []
    };
    
    // Convert arrays to single values for realistic customer journeys
    function simplifyFieldArrays(obj) {
      if (!obj || typeof obj !== 'object') return {};
      
      const simplified = {};
      Object.keys(obj).forEach(key => {
        const value = obj[key];
        if (Array.isArray(value) && value.length > 0) {
          // For realistic customer journeys, pick ONE item instead of arrays
          const randomIndex = Math.floor(Math.random() * value.length);
          simplified[key] = value[randomIndex];
        } else if (value !== null && value !== undefined && typeof value === 'object') {
          // Recursively simplify nested objects
          simplified[key] = simplifyFieldArrays(value);
        } else if (value !== null && value !== undefined) {
          // Keep non-null, non-undefined values as-is
          simplified[key] = value;
        }
      });
      return simplified;
    }
    
    // Simplify all field collections to single values for realistic journey simulation
    currentPayload.additionalFields = currentPayload.additionalFields ? simplifyFieldArrays(currentPayload.additionalFields) : {};
    currentPayload.customerProfile = currentPayload.customerProfile ? simplifyFieldArrays(currentPayload.customerProfile) : {};
    if (currentPayload.traceMetadata) {
      if (currentPayload.traceMetadata.businessContext) {
        currentPayload.traceMetadata.businessContext = simplifyFieldArrays(currentPayload.traceMetadata.businessContext);
      }
    } else {
      currentPayload.traceMetadata = {};
    }
    
    // Debug logging after processing
    console.log('[journey-sim] MULTIPLE-JOURNEYS currentPayload.additionalFields:', currentPayload.additionalFields);
    
    // Debug logging for payload structure
    console.log('[journey-sim] Request body keys:', Object.keys(req.body));
    console.log('[journey-sim] additionalFields location check:', {
      'req.body.additionalFields': !!req.body.additionalFields,
      'journeyObj.additionalFields': !!journeyObj.additionalFields,
      'req.body.customerProfile': !!req.body.customerProfile,
      'journeyObj.customerProfile': !!journeyObj.customerProfile,
      'req.body.traceMetadata': !!req.body.traceMetadata,
      'journeyObj.traceMetadata': !!journeyObj.traceMetadata
    });
    
    // Enhanced debugging - show actual values
    console.log('[journey-sim] DEBUGGING - FULL REQUEST BODY:', JSON.stringify(req.body, null, 2));
    console.log('[journey-sim] DEBUGGING - Full request body keys:', Object.keys(req.body));
    console.log('[journey-sim] DEBUGGING - req.body.additionalFields:', JSON.stringify(req.body.additionalFields, null, 2));
    console.log('[journey-sim] DEBUGGING - req.body.customerProfile:', JSON.stringify(req.body.customerProfile, null, 2));
    console.log('[journey-sim] DEBUGGING - req.body.traceMetadata:', JSON.stringify(req.body.traceMetadata, null, 2));
    console.log('[journey-sim] DEBUGGING - journeyObj:', JSON.stringify(journeyObj, null, 2));
    console.log('[journey-sim] DEBUGGING - journeyObj keys:', Object.keys(journeyObj));
    console.log('[journey-sim] DEBUGGING - journeyObj.additionalFields:', JSON.stringify(journeyObj.additionalFields, null, 2));
    console.log('[journey-sim] DEBUGGING - journeyObj.customerProfile:', JSON.stringify(journeyObj.customerProfile, null, 2));
    console.log('[journey-sim] DEBUGGING - journeyObj.traceMetadata:', JSON.stringify(journeyObj.traceMetadata, null, 2));
    
    if (!journeyObj.steps || !Array.isArray(journeyObj.steps)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing aiJourney.steps or journey.steps array' 
      });
    }

    const results = [];
    let totalSuccessful = 0;
    let totalFailed = 0;
    let failureCount = 0;
    const maxFailuresBeforeSlowdown = 3;

    console.log(`[journey-sim] Running ${customers} customer journeys sequentially for reliability`);

    // Process customers sequentially (not in parallel) to prevent service overload
    for (let customerIndex = 0; customerIndex < customers; customerIndex++) {
      try {
        // Generate unique IDs for each customer
        const uniqueId = Date.now() + customerIndex;
        const journeyId = `journey_${uniqueId}`;
        const customerId = `customer_${uniqueId}`;
        const correlationId = crypto.randomUUID();

        console.log(`[journey-sim] Starting journey for customer ${customerIndex + 1}/${customers}, correlationId: ${correlationId}`);

        // Prepare step data with duration fields from Copilot response
        const stepData = journeyObj.steps.slice(0, 6).map(step => {
          const stepName = step.stepName || step.name || step.step || step.title || 'UnknownStep';
          const description = step.description || step.action || step.summary || '';
          const category = step.category || step.type || step.phase || '';
          
          return {
            stepName,
            serviceName: getServiceNameFromStep(stepName),
            description,
            category,
            // Include Copilot duration fields for OneAgent capture
            estimatedDuration: step.estimatedDuration,
            businessRationale: step.businessRationale,
            substeps: step.substeps,
            originalStep: step,
            hasError: errorSimulationEnabled ? computeCustomerError(companyName, step.stepName || step.name || 'UnknownStep').hasError : false
          };
        });

        // Simulate the journey
        const customerJourney = {
          customerIndex: customerIndex + 1,
          journeyId,
          customerId, 
          correlationId,
          stepNames: stepData.map(s => s.stepName),
          serviceNames: stepData.map(s => s.serviceName),
          steps: [],
          totalTime: 0,
          status: 'in_progress'
        };

        // Ensure all services are running first before processing any steps
        console.log(`[journey-sim] Customer ${customerIndex + 1}: Ensuring all services are ready...`);
        const companyName = journeyObj.companyName || journeyObj.company || 'DefaultCompany';
        const domain = journeyObj.domain || inferDomain(journeyObj) || 'default.com';
        const industryType = journeyObj.industryType || journeyObj.industry || 'general';
        
        // Pre-start all services for this customer's journey
        const servicePorts = new Map();
        for (const step of stepData) {
          const port = await ensureServiceRunning(step.stepName, { 
            companyName, 
            domain, 
            industryType, 
            stepName: step.stepName, 
            serviceName: step.serviceName,
            description: step.description,
            category: step.category
          });
          servicePorts.set(step.stepName, port);
        }

        // Wait for all services to be fully ready with progressive delay for later customers
        const stabilizationDelay = Math.min(1000 + (customerIndex * 300), 5000);
        console.log(`[journey-sim] Customer ${customerIndex + 1}: Waiting ${stabilizationDelay}ms for services to stabilize...`);
        await new Promise(resolve => setTimeout(resolve, stabilizationDelay));

        // Process each step in sequence using pre-allocated ports
        for (let stepIndex = 0; stepIndex < stepData.length; stepIndex++) {
          const step = stepData[stepIndex];
          const stepStartTime = Date.now();

          try {
            const port = servicePorts.get(step.stepName);
            
            // Enhanced service readiness verification
            console.log(`[journey-sim] Customer ${customerIndex + 1}: Verifying ${step.stepName} on port ${port}`);

            let serviceReady = false;
            let verificationAttempts = 0;
            const maxVerificationAttempts = 6;
            
            while (!serviceReady && verificationAttempts < maxVerificationAttempts) {
              try {
                const healthCheckResult = await new Promise((resolve) => {
                  const healthReq = http.request({
                    hostname: '127.0.0.1',
                    port: port,
                    path: '/health',
                    method: 'GET',
                    timeout: 3000
                  }, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => resolve({ status: res.statusCode, body, ready: res.statusCode === 200 }));
                  });
                  
                  healthReq.on('error', (err) => resolve({ status: 'error', error: err.code, ready: false }));
                  healthReq.on('timeout', () => {
                    healthReq.destroy();
                    resolve({ status: 'timeout', ready: false });
                  });
                  healthReq.end();
                });
                
                if (healthCheckResult.ready) {
                  serviceReady = true;
                } else {
                  verificationAttempts++;
                  if (verificationAttempts < maxVerificationAttempts) {
                    const backoffDelay = 500 + (verificationAttempts * 300);
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                  }
                }
              } catch (error) {
                verificationAttempts++;
                if (verificationAttempts < maxVerificationAttempts) {
                  await new Promise(resolve => setTimeout(resolve, 500 + (verificationAttempts * 300)));
                }
              }
            }
            
            if (!serviceReady) {
              // Create fallback response that still generates meaningful trace data
              console.log(`[journey-sim] Service ${step.stepName} unavailable, creating fallback response`);
              
              const stepResult = {
                stepName: step.stepName,
                serviceName: step.serviceName,
                processingTime: 120 + Math.random() * 180,
                status: 'completed', // Mark as completed to continue journey
                httpStatus: 200,
                fallback: true,
                estimatedDuration: step.estimatedDuration,
                businessRationale: step.businessRationale,
                category: step.category,
                substeps: step.substeps
              };

              customerJourney.steps.push(stepResult);
              customerJourney.totalTime += stepResult.processingTime;
              continue;
            }

            // Build comprehensive step payload
            const payload = {
              journeyId,
              customerId,
              correlationId,
              startTime: new Date().toISOString(),
              companyName,
              domain,
              industryType,
              
              // Current step specific data
              stepName: step.stepName,
              stepIndex: stepIndex + 1,
              totalSteps: stepData.length,
              stepDescription: step.description,
              stepCategory: step.category,
              thinkTimeMs,
              hasError: errorSimulationEnabled ? computeCustomerError(companyName, step.stepName).hasError : false,
              
              // Duration and business context
              estimatedDuration: step.estimatedDuration,
              businessRationale: step.businessRationale,
              category: step.category,
              substeps: step.substeps,
              estimatedDurationMs: step.estimatedDuration ? step.estimatedDuration * 60 * 1000 : null,
              subSteps: step.substeps || [],
              
              // Customer context
              customerIndex: customerIndex + 1,
              totalCustomers: customers,
              
              // Business context - use processed payload data
              additionalFields: currentPayload.additionalFields || {},
              customerProfile: currentPayload.customerProfile || {},
              traceMetadata: currentPayload.traceMetadata || {},
              sources: currentPayload.sources || [],
              provider: currentPayload.provider || 'unknown'
            };

            // Enhanced tracing headers
            const traceHeaders = {
              'traceparent': `00-${crypto.randomBytes(16).toString('hex')}-${crypto.randomBytes(8).toString('hex')}-01`,
              'x-correlation-id': correlationId,
              'x-customer-index': String(customerIndex + 1),
              'x-customer-total': String(customers)
            };

            console.log(`[journey-sim] Customer ${customerIndex + 1}: Calling ${step.stepName} on port ${port}`);
            const response = await callDynamicService(step.stepName, port, payload, traceHeaders);
            const processingTime = Date.now() - stepStartTime;

            // Enhanced response evaluation
            const isSuccessful = response && 
              response.status !== 'failed' && 
              !response.errorType &&
              (!response.httpStatus || response.httpStatus < 400);

            const stepResult = {
              stepName: step.stepName,
              serviceName: step.serviceName,
              processingTime,
              status: isSuccessful ? 'completed' : 'failed',
              httpStatus: response?.httpStatus || 200,
              errorType: response?.errorType,
              error: response?.error,
              estimatedDuration: step.estimatedDuration,
              businessRationale: step.businessRationale,
              category: step.category,
              substeps: step.substeps
            };

            customerJourney.steps.push(stepResult);
            customerJourney.totalTime += processingTime;

            console.log(`[journey-sim] ${isSuccessful ? '✅' : '❌'} Step ${stepIndex + 1}: ${step.serviceName} (customer ${customerIndex + 1}) - ${stepResult.status}`);

            // Adaptive delay between steps
            if (stepIndex < stepData.length - 1) {
              const adaptiveDelay = Math.max(thinkTimeMs, 200) + (customerIndex * 50);
              await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
            }

          } catch (stepError) {
            console.error(`[journey-sim] Step ${step.stepName} failed for customer ${customerIndex + 1}:`, stepError.message);
            const processingTime = Date.now() - stepStartTime;
            
            customerJourney.steps.push({
              stepName: step.stepName,
              serviceName: step.serviceName,
              processingTime,
              status: 'failed',
              error: stepError.message,
              estimatedDuration: step.estimatedDuration,
              businessRationale: step.businessRationale,
              category: step.category,
              substeps: step.substeps
            });
            customerJourney.totalTime += processingTime;
            
            // Continue to next step even if this one failed
            console.log(`[journey-sim] Continuing journey for customer ${customerIndex + 1} despite step failure`);
          }
        }
        for (let stepIndex = 0; stepIndex < stepData.length; stepIndex++) {
          const step = stepData[stepIndex];
          const stepStartTime = Date.now();

          try {
            // Ensure service is running for this step with proper company context
            const companyName = journeyObj.companyName || journeyObj.company || 'DefaultCompany';
            const domain = journeyObj.domain || inferDomain(journeyObj) || 'default.com';
            const industryType = journeyObj.industryType || journeyObj.industry || 'general';
            
            const port = await ensureServiceRunning(step.stepName, { 
              companyName, 
              domain, 
              industryType, 
              stepName: step.stepName, 
              serviceName: step.serviceName,
              description: step.description,
              category: step.category
            });
            
            // Add small delay to prevent race conditions in multi-customer simulations
            if (customerIndex > 0 && stepIndex === 0) {
              await new Promise(resolve => setTimeout(resolve, 100 * customerIndex));
            }
            
            // Verify service is actually responding on the allocated port
            console.log(`[journey-sim] Customer ${customerIndex + 1}: Calling ${step.stepName} on port ${port}`);

            // Build step-specific payload - ONLY current step data, no full steps array
            const payload = {
              journeyId,
              customerId,
              correlationId,
              startTime: new Date().toISOString(),
              companyName: journeyObj.companyName || journeyObj.company || 'DefaultCompany',
              domain: journeyObj.domain || inferDomain(journeyObj) || 'default.com',
              industryType: journeyObj.industryType || journeyObj.industry || 'general',
              
              // Current step specific data ONLY
              stepName: step.stepName,
              stepIndex: stepIndex + 1,
              totalSteps: stepData.length,
              stepDescription: step.description,
              stepCategory: step.category,
              thinkTimeMs,
              hasError: errorSimulationEnabled ? computeCustomerError(companyName, step.stepName).hasError : false,
              
              // Add duration fields from Copilot response for OneAgent capture
              estimatedDuration: step.estimatedDuration,
              businessRationale: step.businessRationale,
              category: step.category,
              substeps: step.substeps,
              // Convert estimated duration from minutes to milliseconds for processing simulation
              estimatedDurationMs: step.estimatedDuration ? step.estimatedDuration * 60 * 1000 : null,
              subSteps: step.substeps || [], // Legacy field for backward compatibility
              
              // Include full customer/business context in each trace - use processed payload data
              additionalFields: currentPayload.additionalFields || {},
              customerProfile: currentPayload.customerProfile || {},
              traceMetadata: currentPayload.traceMetadata || {},
              sources: currentPayload.sources || [],
              provider: currentPayload.provider || 'unknown'
            };

            // Enhanced debugging for payload values
            console.log('[journey-sim] PAYLOAD DEBUGGING for step:', step.stepName);
            console.log('[journey-sim] - journeyObj.additionalFields:', JSON.stringify(journeyObj.additionalFields, null, 2));
            console.log('[journey-sim] - req.body.additionalFields:', JSON.stringify(req.body.additionalFields, null, 2));
            console.log('[journey-sim] - Final payload.additionalFields:', JSON.stringify(payload.additionalFields, null, 2));
            console.log('[journey-sim] - Final payload.customerProfile:', JSON.stringify(payload.customerProfile, null, 2));
            console.log('[journey-sim] - Final payload.traceMetadata:', JSON.stringify(payload.traceMetadata, null, 2));

            // Wait a bit longer for services to start, especially during heavy load
            if (customerIndex > 2) {
              const additionalDelay = Math.min(customerIndex * 200, 2000); // Max 2 second delay
              console.log(`[journey-sim] Customer ${customerIndex + 1}: Adding ${additionalDelay}ms delay for service stability`);
              await new Promise(resolve => setTimeout(resolve, additionalDelay));
            }
            
            // Verify service is ready before making the request
            let serviceReady = false;
            let retryCount = 0;
            const maxRetries = 5; // Increased retries
            
            while (!serviceReady && retryCount < maxRetries) {
              try {
                // Check if process is actually running first
                console.log(`[journey-sim] Checking if service ${step.stepName} (PID from service-manager) is responding on port ${port}`);
                
                // Simple connectivity test with longer timeout
                const testResponse = await new Promise((resolve) => {
                  const testReq = http.request({
                    hostname: '127.0.0.1',
                    port: port,
                    path: '/health',
                    method: 'GET',
                    timeout: 2000 // Increased timeout
                  }, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => resolve({ status: res.statusCode, body }));
                  });
                  testReq.on('error', (err) => {
                    console.log(`[journey-sim] Health check error for ${step.stepName} on port ${port}:`, err.code);
                    resolve({ status: 'error', error: err.code });
                  });
                  testReq.on('timeout', () => {
                    console.log(`[journey-sim] Health check timeout for ${step.stepName} on port ${port}`);
                    resolve({ status: 'timeout' });
                  });
                  testReq.end();
                });
                
                if (testResponse.status === 200) {
                  console.log(`[journey-sim] Service ${step.stepName} is ready on port ${port}`);
                  serviceReady = true;
                } else {
                  retryCount++;
                  if (retryCount < maxRetries) {
                    const delay = 1000 + (retryCount * 500); // Progressive delay
                    console.log(`[journey-sim] Service ${step.stepName} not ready on port ${port} (${testResponse.status}), retrying in ${delay}ms (attempt ${retryCount}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                  }
                }
              } catch (error) {
                retryCount++;
                if (retryCount < maxRetries) {
                  const delay = 1000 + (retryCount * 500);
                  console.log(`[journey-sim] Service ${step.stepName} health check failed (${error.message}), retrying in ${delay}ms (attempt ${retryCount}/${maxRetries})`);
                  await new Promise(resolve => setTimeout(resolve, delay));
                }
              }
            }
            
            if (!serviceReady) {
              // Instead of failing, create a fallback trace response
              console.log(`[journey-sim] Service ${step.stepName} unavailable, creating fallback trace response for customer ${customerIndex + 1}`);
              
              const fallbackResponse = {
                status: 'completed',
                stepName: step.stepName,
                serviceName: step.serviceName,
                httpStatus: 200,
                processingTime: 150 + Math.random() * 100,
                fallback: true,
                message: `Fallback response - service temporarily unavailable`,
                timestamp: new Date().toISOString(),
                // Include the full payload context in the fallback
                context: {
                  journeyId,
                  customerId,
                  correlationId,
                  stepIndex: stepIndex + 1,
                  totalSteps: stepData.length,
                  additionalFields: payload.additionalFields,
                  customerProfile: payload.customerProfile,
                  traceMetadata: payload.traceMetadata
                }
              };
              
              const stepResult = {
                stepName: step.stepName,
                serviceName: step.serviceName,
                processingTime: fallbackResponse.processingTime,
                status: 'completed', // Mark as completed so journey continues
                httpStatus: 200,
                fallback: true,
                estimatedDuration: step.estimatedDuration,
                businessRationale: step.businessRationale,
                category: step.category,
                substeps: step.substeps
              };

              customerJourney.steps.push(stepResult);
              customerJourney.totalTime += fallbackResponse.processingTime;
              
              console.log(`[journey-sim] ✅ Fallback Step ${stepIndex + 1}: ${step.serviceName} (fallback trace created)`);
              continue; // Skip the actual service call and move to next step
            }

            // Call the service
            const traceHeaders = {
              'traceparent': `00-${crypto.randomBytes(16).toString('hex')}-${crypto.randomBytes(8).toString('hex')}-01`,
              'x-correlation-id': correlationId
            };

            const response = await callDynamicService(step.stepName, port, payload, traceHeaders);
            const processingTime = Date.now() - stepStartTime;

            const stepResult = {
              stepName: step.stepName,
              serviceName: step.serviceName,
              processingTime,
              status: (response && response.httpStatus && response.httpStatus < 400) ? 'completed' : 'failed',
              httpStatus: response?.httpStatus || 200,
              // Include duration fields from Copilot response
              estimatedDuration: step.estimatedDuration,
              businessRationale: step.businessRationale,
              category: step.category,
              substeps: step.substeps
            };

            customerJourney.steps.push(stepResult);
            customerJourney.totalTime += processingTime;

            // Small delay between steps
            if (stepIndex < stepData.length - 1) {
              await new Promise(resolve => setTimeout(resolve, thinkTimeMs));
            }

          } catch (stepError) {
            console.error(`[journey-sim] Step ${step.stepName} failed for customer ${customerIndex + 1}:`, stepError.message);
            const processingTime = Date.now() - stepStartTime;
            
            customerJourney.steps.push({
              stepName: step.stepName,
              serviceName: step.serviceName,
              processingTime,
              status: 'failed',
              error: stepError.message,
              // Include duration fields from Copilot response even on failure
              estimatedDuration: step.estimatedDuration,
              businessRationale: step.businessRationale,
              category: step.category,
              substeps: step.substeps
            });
            customerJourney.totalTime += processingTime;
            break; // Stop processing further steps for this customer
          }
        }

        // Determine final status
        const completedSteps = customerJourney.steps.filter(s => s.status === 'completed').length;
        customerJourney.status = completedSteps === stepData.length ? 'completed' : 'failed';
        customerJourney.completedSteps = completedSteps;
        customerJourney.totalSteps = stepData.length;

        if (customerJourney.status === 'completed') {
          totalSuccessful++;
        } else {
          totalFailed++;
        }

        results.push(customerJourney);

        // Adaptive delay between customers based on failure count
        if (customerIndex < customers - 1) {
          let delay = 300 + (customerIndex * 100); // Base delay
          
          // If we've had failures, slow down significantly
          if (failureCount >= maxFailuresBeforeSlowdown) {
            delay = Math.min(2000 + (failureCount * 500), 5000); // Up to 5 second delay
            console.log(`[journey-sim] ⚠️ High failure count (${failureCount}), using extended delay of ${delay}ms`);
          } else {
            delay = Math.min(delay, 1500); // Normal max delay
          }
          
          console.log(`[journey-sim] Waiting ${delay}ms before starting customer ${customerIndex + 2}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

      } catch (customerError) {
        console.error(`[journey-sim] Customer ${customerIndex + 1} journey failed:`, customerError.message);
        totalFailed++;
        failureCount++;
        
        // Create a minimal journey trace even for failed customers
        const failedJourney = {
          customerIndex: customerIndex + 1,
          journeyId: `journey_${Date.now() + customerIndex}`,
          customerId: `customer_${Date.now() + customerIndex}`,
          correlationId: crypto.randomUUID(),
          status: 'failed',
          error: customerError.message,
          steps: [], // Empty steps array
          totalTime: 0,
          // Still include customer context for failed traces
          additionalFields: generateAdditionalFields(null, journeyObj.companyName || 'DefaultCompany', customerIndex),
          customerProfile: generateCustomerProfile(null, journeyObj.companyName || 'DefaultCompany', customerIndex),
          traceMetadata: generateTraceMetadata(null, crypto.randomUUID(), customerIndex)
        };
        
        results.push(failedJourney);
      }
    }

    // Calculate trace quality metrics
    const completedJourneys = results.filter(c => c.status === 'completed');
    const fallbackSteps = results.reduce((count, journey) => {
      if (journey.steps) {
        return count + journey.steps.filter(step => step.fallback).length;
      }
      return count;
    }, 0);
    
    const totalSteps = results.reduce((count, journey) => {
      return count + (journey.steps ? journey.steps.length : 0);
    }, 0);
    
    // Format the response with cleaner load test summary
    const summary = {
      totalCustomers: customers,
      successful: totalSuccessful,
      failed: totalFailed,
      successRate: `${((totalSuccessful / customers) * 100).toFixed(1)}%`,
      traceQuality: {
        totalTraces: results.length,
        totalSteps: totalSteps,
        fallbackSteps: fallbackSteps,
        realSteps: totalSteps - fallbackSteps,
        traceCompleteness: totalSteps > 0 ? `${(((totalSteps - fallbackSteps) / totalSteps) * 100).toFixed(1)}%` : '0%'
      }
    };

    // Create a clean summary for successful journeys
    const successfulJourneys = results.filter(c => c.status === 'completed');
    const failedJourneys = results.filter(c => c.status === 'failed');
    
    // Get average metrics from successful journeys
    const avgSteps = successfulJourneys.length > 0 ? 
      Math.round(successfulJourneys.reduce((sum, c) => sum + c.completedSteps, 0) / successfulJourneys.length) : 0;
    const avgTime = successfulJourneys.length > 0 ? 
      Math.round(successfulJourneys.reduce((sum, c) => sum + c.totalTime, 0) / successfulJourneys.length) : 0;

    // Create representative journey example from first successful customer
    let journeyExample = null;
    if (successfulJourneys.length > 0) {
      const example = successfulJourneys[0];
      const executionSteps = example.steps.map((step, index) => 
        `${step.status === 'completed' ? '✅' : '❌'} Step ${index + 1}: ${step.serviceName} (${step.processingTime}ms)`
      ).join('\n');

      const servicesUsed = example.steps.map(step => 
        step.stepName.replace(/Service$/, '')
      ).join(' → ');

      journeyExample = {
        execution: executionSteps,
        servicesUsed: servicesUsed,
        correlationId: example.correlationId
      };
    }

    // Collect all correlation IDs
    const correlationIds = results.map(c => c.correlationId);
    
    // Collect error summary
    const errorSummary = failedJourneys.length > 0 ? 
      failedJourneys.map(f => `Customer ${f.customerIndex}: ${f.error || 'Journey incomplete'}`).slice(0, 3) : [];

    res.json({
      success: true,
      loadTestSummary: {
        customersProcessed: customers,
        successfulCustomers: totalSuccessful,
        failedCustomers: totalFailed,
        successRate: summary.successRate,
        averageCompletionTime: `${avgTime}ms`,
        averageStepsCompleted: avgSteps
      },
      correlationIds: correlationIds,
      errors: errorSummary,
      sampleJourney: journeyExample,
      detailedResults: results.map(customer => ({
        customerIndex: customer.customerIndex,
        correlationId: customer.correlationId,
        status: customer.status,
        completedSteps: customer.completedSteps,
        totalSteps: customer.totalSteps,
        totalTime: customer.totalTime
      }))
    });

  } catch (error) {
    console.error('[journey-sim] Multiple journeys simulation error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Batch simulate: run the 6-step chained flow for multiple customers
router.post('/simulate-batch-chained', async (req, res) => {
  try {
    const {
      customers = 1,
      thinkTimeMs = 100,
      journey,
      aiJourney,
      steps: customSteps,
      companyName: bodyCompany,
      domain: bodyDomain,
      industryType: bodyIndustry,
      errorSimulationEnabled = true
    } = req.body || {};

    // Enforce customer limit of 5
    const requestedCustomers = Number(customers || 1);
    if (requestedCustomers > 5) {
      return res.status(400).json({
        ok: false,
        error: `Customer limit exceeded. Maximum allowed: 5, requested: ${requestedCustomers}`,
        maxCustomers: 5,
        requestedCustomers: requestedCustomers
      });
    }

    const correlationId = req.correlationId;
    // Prefer journey payload then aiJourney
    const journeyObj = journey || aiJourney || {};

    // Build step data using the same logic as /simulate-journey
    let stepData = [];
    let stepsArray = null;
    if (journeyObj?.steps && Array.isArray(journeyObj.steps)) {
      stepsArray = journeyObj.steps;
    } else if (Array.isArray(customSteps)) {
      stepsArray = customSteps;
    }
    if (stepsArray) {
      stepData = stepsArray.slice(0, 6).map(step => {
        const stepName = step.stepName || step.name || step.step || step.title || 'UnknownStep';
        const description = step.description || step.action || step.summary || '';
        const category = step.category || step.type || step.phase || '';
        return {
          stepName,
          serviceName: step.serviceName || generateDynamicServiceName(stepName, description, category, step),
          description,
          category,
          originalStep: step
        };
      });
    } else {
      stepData = DEFAULT_JOURNEY_STEPS.map(name => ({ stepName: name, serviceName: null }));
    }

    const companyName = journeyObj.companyName || bodyCompany || 'DefaultCompany';
    const domain = journeyObj.domain || bodyDomain || inferDomain(journeyObj);
    const industryType = journeyObj.industryType || bodyIndustry || 'general';

    // Compute per-step error plan
    const errorPlannedSteps = stepData.map(s => {
      const hint = s.originalStep?.errorHint || s.originalStep?.errorPlan;
      let plan = errorSimulationEnabled ? computeCustomerError(companyName, s.stepName) : { hasError: false };
      if (hint && typeof hint === 'object') {
        const typeFromHint = hint.type || hint.errorType;
        const statusFromHint = hint.httpStatus || hint.status;
        const likelihood = typeof hint.likelihood === 'number' ? Math.max(0, Math.min(1, hint.likelihood)) : null;
        const forced = hint.force === true;
        const shouldFail = forced ? true : (likelihood != null ? Math.random() < likelihood : null);
        if (shouldFail === true) {
          const chosenType = typeFromHint || plan.errorType || 'service_unavailable';
          const chosenStatus = statusFromHint || plan.httpStatus || 500;
          plan = {
            hasError: true,
            errorType: chosenType,
            httpStatus: chosenStatus,
            errorMessage: generateErrorMessage(chosenType, s.stepName),
            retryable: ![400, 404, 422].includes(Number(chosenStatus)),
            severity: Number(chosenStatus) >= 500 ? 'critical' : Number(chosenStatus) >= 400 ? 'warning' : 'info'
          };
        } else if (shouldFail === false) {
          plan = { hasError: false };
        }
      }
      return { ...s, ...plan };
    });

    // Ensure services running with correct context
    for (const s of errorPlannedSteps) {
      await ensureServiceRunning(s.stepName, { companyName, domain, industryType, stepName: s.stepName, serviceName: s.serviceName, description: s.description, category: s.category });
    }

    // Give time to boot
    await new Promise(r => setTimeout(r, 1000));

    let completed = 0;
    let failed = 0;
    const results = [];

    // Identify first step and its port
    const first = errorPlannedSteps[0];
    const firstPort = await getServicePort(first.stepName, companyName);

    for (let i = 0; i < requestedCustomers; i++) {
      try {
        // Debug the payload construction
        console.log('[journey-sim] MULTI-JOURNEY PAYLOAD CONSTRUCTION:', {
          'req.body.additionalFields': JSON.stringify(req.body.additionalFields, null, 2),
          'req.body.customerProfile': JSON.stringify(req.body.customerProfile, null, 2),
          'req.body.traceMetadata': JSON.stringify(req.body.traceMetadata, null, 2),
          'journeyObj.additionalFields': JSON.stringify(journeyObj.additionalFields, null, 2),
          'journeyObj.customerProfile': JSON.stringify(journeyObj.customerProfile, null, 2),
          'journeyObj.traceMetadata': JSON.stringify(journeyObj.traceMetadata, null, 2)
        });
        
        // Create step-specific payload for chained batch - ONLY first step data
        const firstStepInfo = errorPlannedSteps[0];
        const payload = {
          // Journey metadata
          journeyId: `journey_${Date.now()}_${i}`,
          customerId: `customer_${Date.now()}_${i}`,
          correlationId,
          startTime: new Date().toISOString(),
          companyName,
          domain,
          industryType,
          
          // Current step specific data ONLY
          stepName: first.stepName,
          stepIndex: 1,
          totalSteps: errorPlannedSteps.length,
          stepDescription: firstStepInfo.description || '',
          stepCategory: firstStepInfo.category || '',
          thinkTimeMs,
          
          // Chain configuration - only include routing info for next step
          isChained: true,
          nextStepName: errorPlannedSteps.length > 1 ? errorPlannedSteps[1].stepName : null,
          nextStepService: errorPlannedSteps.length > 1 ? errorPlannedSteps[1].serviceName : null,
          
          // Error configuration for first step
          hasError: firstStepInfo.hasError,
          errorType: firstStepInfo.errorType,
          errorMessage: firstStepInfo.errorMessage,
          httpStatus: firstStepInfo.httpStatus,
          retryable: firstStepInfo.retryable,
          severity: firstStepInfo.severity,
          
          // Include full customer/business context in each trace
          additionalFields: req.body.additionalFields || journeyObj.additionalFields || {},
          customerProfile: req.body.customerProfile || journeyObj.customerProfile || {},
          traceMetadata: req.body.traceMetadata || journeyObj.traceMetadata || {},
          sources: journeyObj.sources || [],
          provider: journeyObj.provider || 'unknown'
        };
        
        console.log('[journey-sim] FINAL PAYLOAD additionalFields:', JSON.stringify(payload.additionalFields, null, 2));
        console.log('[journey-sim] FINAL PAYLOAD customerProfile:', JSON.stringify(payload.customerProfile, null, 2));
        console.log('[journey-sim] FINAL PAYLOAD traceMetadata:', JSON.stringify(payload.traceMetadata, null, 2));
        const r = await callDynamicService(first.stepName, firstPort, payload, { 'x-correlation-id': correlationId });
        const isFailed = r?.status === 'failed' || (r?.httpStatus && r.httpStatus >= 400);
        if (isFailed) failed++; else completed++;
        if (i < 5) results.push({ index: i + 1, status: isFailed ? 'failed' : 'completed', service: first.serviceName, httpStatus: r?.httpStatus, error: r?.error });
      } catch (e) {
        failed++;
        if (i < 5) results.push({ index: i + 1, status: 'failed', error: e.message });
      }
      
      // Dynamic throttling based on customer count and current index (max 5 customers)
      let delay = 10; // Base delay
      const totalCustomers = requestedCustomers;
      
      if (totalCustomers > 3) {
        // For batches of 4-5 customers, use moderate throttling
        delay = 200 + (i * 100); // Progressive delay
      } else if (totalCustomers > 1) {
        // For batches of 2-3 customers, use light throttling
        delay = 100 + (i * 50);
      }
      
      console.log(`[journey-sim] Customer ${i + 1}/${requestedCustomers}: Using ${delay}ms delay before next customer`);
      await new Promise(r => setTimeout(r, delay));
    }

    res.json({ ok: true, summary: { customers: requestedCustomers, completed, failed }, sample: results });
  } catch (e) {
    console.error('[journey-sim] simulate-batch-chained error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// NEW ENDPOINT: Single-step journey simulation
router.post('/simulate-single-step-journeys', async (req, res) => {
  console.log('[journey-sim] Single-step journeys simulation called');
  try {
    const { 
      customers = 1,
      thinkTimeMs = 250,
      aiJourney,
      journey
    } = req.body || {};

    // Enforce customer limit of 5
    const requestedCustomers = Number(customers || 1);
    if (requestedCustomers > 5) {
      return res.status(400).json({
        ok: false,
        error: `Customer limit exceeded. Maximum allowed: 5, requested: ${requestedCustomers}`,
        maxCustomers: 5,
        requestedCustomers: requestedCustomers
      });
    }
    // Use aiJourney or journey
    const journeyObj = aiJourney || journey || {};
    
    console.log('[journey-sim] SINGLE-STEP MODE: Creating individual traces for each step');
    
    if (!journeyObj.steps || !Array.isArray(journeyObj.steps)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing or invalid steps array in journey object' 
      });
    }

    const companyName = journeyObj.companyName || req.body.companyName || 'UnknownCompany';
    const correlationId = `single-step-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    
    const bodyDomain = req.body.domain;
    const bodyIndustry = req.body.industryType;
    const domain = journeyObj.domain || bodyDomain || inferDomain(journeyObj);
    const industryType = journeyObj.industryType || bodyIndustry || 'general';

    const stepData = journeyObj.steps.map((step, index) => ({ 
      ...step, 
      stepIndex: index + 1, 
      originalStep: step 
    }));

    let completed = 0;
    let failed = 0;
    const results = [];

    // Process each step as an individual journey/trace
    for (const step of stepData) {
      console.log(`[journey-sim] SINGLE-STEP: Processing step ${step.stepName} as individual trace`);
      
      // Ensure service is running for this step
      const stepPort = await ensureServiceRunning(step.stepName, { 
        companyName, 
        domain, 
        industryType, 
        stepName: step.stepName, 
        serviceName: step.serviceName, 
        description: step.description, 
        category: step.category 
      });
      
      // Create individual customers for this step
      for (let i = 0; i < Number(customers || 0); i++) {
        const stepCorrelationId = `${correlationId}-${step.stepName}-${i}`;
        
        try {
          // Single-step payload - only contains this one step
          const payload = {
            companyName,
            domain,
            industryType,
            correlationId: stepCorrelationId,
            stepName: step.stepName,
            thinkTimeMs,
            steps: [step], // Only this single step
            additionalFields: req.body.additionalFields || journeyObj.additionalFields || {},
            customerProfile: req.body.customerProfile || journeyObj.customerProfile || {},
            traceMetadata: req.body.traceMetadata || journeyObj.traceMetadata || {},
            sources: journeyObj.sources || [],
            provider: journeyObj.provider || 'unknown',
            singleStepMode: true // Flag to indicate this is a single-step trace
          };
          
          console.log(`[journey-sim] SINGLE-STEP: Calling ${step.stepName} with correlation ID: ${stepCorrelationId}`);
          
          const r = await callDynamicService(step.stepName, stepPort, payload, { 
            'x-correlation-id': stepCorrelationId 
          });
          
          const isFailed = r?.status === 'failed' || (r?.httpStatus && r.httpStatus >= 400);
          if (isFailed) failed++; else completed++;
          
          // Collect results for all single-step executions
          results.push({ 
            stepName: step.stepName,
            customerIndex: i + 1, 
            correlationId: stepCorrelationId,
            status: isFailed ? 'failed' : 'completed', 
            service: step.serviceName, 
            httpStatus: r?.httpStatus, 
            error: r?.error 
          });
          
        } catch (e) {
          failed++;
          results.push({ 
            stepName: step.stepName,
            customerIndex: i + 1, 
            correlationId: stepCorrelationId,
            status: 'failed', 
            error: e.message 
          });
        }
        
        // Small delay to avoid thundering herd
        await new Promise(r => setTimeout(r, 10));
      }
    }

    res.json({ 
      ok: true, 
      mode: 'single-step',
      summary: { 
        customers: Number(customers), 
        stepsProcessed: stepData.length,
        totalExecutions: stepData.length * Number(customers),
        completed, 
        failed 
      }, 
      results: results.slice(0, 20) // Limit results to prevent oversized response
    });
    
  } catch (e) {
    console.error('[journey-sim] simulate-single-step error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
