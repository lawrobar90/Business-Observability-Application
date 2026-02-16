/**
 * Enhanced Dynatrace Error Handling and Trace Failure Reporting
 * Ensures exceptions are properly captured and propagated in traces
 * Uses @dynatrace/oneagent-sdk when available for real trace integration
 */

// Try to load the real Dynatrace OneAgent SDK
let dtSdk = null;
let dtApi = null;
try {
  dtSdk = require('@dynatrace/oneagent-sdk');
  dtApi = dtSdk.createInstance();
  console.log('[dynatrace-sdk] OneAgent SDK loaded successfully, state:', dtApi.getCurrentState());
} catch (e) {
  console.log('[dynatrace-sdk] OneAgent SDK not available, using fallback logging:', e.message);
}

// Dynatrace API helpers for error reporting — uses real SDK when available
const addCustomAttributes = (attributes) => {
  if (dtApi && typeof dtApi.addCustomRequestAttribute === 'function') {
    // Use real OneAgent SDK to attach attributes to the current PurePath trace
    for (const [key, value] of Object.entries(attributes)) {
      try {
        dtApi.addCustomRequestAttribute(key, String(value));
      } catch (e) {
        // Silently skip if attribute can't be added
      }
    }
  }
  console.log('[dynatrace] Custom attributes:', JSON.stringify(attributes));
};

const reportError = (error, context = {}) => {
  // Attach exception details to the PurePath via OneAgent SDK
  if (dtApi && typeof dtApi.addCustomRequestAttribute === 'function') {
    try {
      dtApi.addCustomRequestAttribute('error.message', error.message || 'Unknown error');
      dtApi.addCustomRequestAttribute('error.type', error.name || error.constructor?.name || 'Error');
      dtApi.addCustomRequestAttribute('error.stack', (error.stack || '').substring(0, 500));
      for (const [key, value] of Object.entries(context)) {
        dtApi.addCustomRequestAttribute(key, String(value));
      }
    } catch (e) {
      // Silently skip
    }
  }
  console.error(`[dynatrace-error] ${error.name || 'Error'}: ${error.message}`, JSON.stringify(context));
};

const markSpanAsFailed = (error, context = {}) => {
  // Attach failure markers to the PurePath via OneAgent SDK
  if (dtApi && typeof dtApi.addCustomRequestAttribute === 'function') {
    try {
      dtApi.addCustomRequestAttribute('span.failed', 'true');
      dtApi.addCustomRequestAttribute('failure.message', error.message || 'Unknown');
      dtApi.addCustomRequestAttribute('failure.category', context['error.category'] || 'unknown');
    } catch (e) {
      // Silently skip
    }
  }
  console.error(`[dynatrace-span-failed] ${error.message}`, JSON.stringify(context));
};

const sendErrorEvent = (eventType, error, context = {}) => {
  console.log('[dynatrace] Error business event:', eventType, {
    error: error.message || error,
    errorType: error.constructor.name || 'Error',
    timestamp: new Date().toISOString(),
    ...context
  });
  // In real Dynatrace environment, this would send a business event
};

/**
 * Enhanced error wrapper that captures errors for Dynatrace tracing
 */
class TracedError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'TracedError';
    this.context = context;
    this.timestamp = new Date().toISOString();
    
    // Immediately report to Dynatrace
    markSpanAsFailed(this, context);
    reportError(this, context);
  }
}

/**
 * Async function wrapper that catches errors and reports them to Dynatrace
 */
const withErrorTracking = (serviceName, operation) => {
  return async (...args) => {
    try {
      const result = await operation(...args);
      return result;
    } catch (error) {
      const context = {
        'service.name': serviceName,
        'operation': operation.name || 'unknown',
        'error.caught': true
      };
      
      // Mark trace as failed
      markSpanAsFailed(error, context);
      reportError(error, context);
      
      // Send error business event
      sendErrorEvent('service_operation_failed', error, {
        serviceName,
        operation: operation.name || 'unknown'
      });
      
      // Re-throw to maintain error flow
      throw new TracedError(error.message, context);
    }
  };
};

/**
 * Express middleware for error handling with Dynatrace integration
 */
const errorHandlingMiddleware = (serviceName) => {
  return (error, req, res, next) => {
    const context = {
      'service.name': serviceName,
      'request.path': req.path,
      'request.method': req.method,
      'correlation.id': req.correlationId,
      'journey.step': req.body?.stepName || 'unknown'
    };
    
    // Report error to Dynatrace
    markSpanAsFailed(error, context);
    reportError(error, context);
    
    // Send error business event
    sendErrorEvent('http_request_failed', error, {
      serviceName,
      path: req.path,
      method: req.method,
      correlationId: req.correlationId,
      stepName: req.body?.stepName
    });
    
    // Add error headers for trace propagation
    res.setHeader('x-trace-error', 'true');
    res.setHeader('x-error-type', error.constructor.name);
    res.setHeader('x-error-message', error.message);
    
    // Return standardized error response
    const errorResponse = {
      status: 'error',
      error: error.message,
      errorType: error.constructor.name,
      timestamp: new Date().toISOString(),
      correlationId: req.correlationId,
      service: serviceName,
      traceError: true
    };
    
    res.status(error.status || 500).json(errorResponse);
  };
};

/**
 * Simulate random errors based on error profiles for testing
 */
const simulateRandomError = (errorProfile, stepName, context = {}) => {
  if (!errorProfile || Math.random() >= errorProfile.errorRate) {
    return null; // No error
  }
  
  const errorType = errorProfile.errorTypes[Math.floor(Math.random() * errorProfile.errorTypes.length)];
  const httpStatus = errorProfile.httpErrors[Math.floor(Math.random() * errorProfile.httpErrors.length)];
  
  const error = new TracedError(`Simulated ${errorType} in ${stepName}`, {
    'error.simulated': true,
    'error.type': errorType,
    'http.status': httpStatus,
    'journey.step': stepName,
    ...context
  });
  
  error.status = httpStatus;
  error.errorType = errorType;
  
  return error;
};

/**
 * Check if a step should fail based on hasError flag or error simulation
 */
const checkForStepError = (payload, errorProfile) => {
  // Check explicit error flag first
  if (payload.hasError === true) {
    const error = new TracedError(
      payload.errorMessage || `Step ${payload.stepName} marked as failed`,
      {
        'error.explicit': true,
        'journey.step': payload.stepName,
        'service.name': payload.serviceName
      }
    );
    error.status = payload.httpStatus || 500;
    return error;
  }
  
  // Check for simulated errors
  if (errorProfile) {
    return simulateRandomError(errorProfile, payload.stepName, {
      'journey.step': payload.stepName,
      'service.name': payload.serviceName
    });
  }
  
  return null;
};

module.exports = {
  TracedError,
  withErrorTracking,
  errorHandlingMiddleware,
  simulateRandomError,
  checkForStepError,
  markSpanAsFailed,
  reportError,
  sendErrorEvent,
  addCustomAttributes
};