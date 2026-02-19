/**
 * BizObs API Service
 * 
 * Communicates with external BizObs Generator server (EC2 instance)
 * Server URL stored in app settings or environment variable
 */

// TODO: Replace with actual server URL from app settings or Dynatrace Credential Vault
const BIZOBS_SERVER_URL = process.env.BIZOBS_SERVER_URL || 'http://3.209.41.33:8080';

export interface ServiceStatus {
  service: string;
  pid: number;
  status: 'running' | 'stopped';
  startTime: number;
  uptime: number;
  port: number;
  stepName: string;
  companyContext: {
    companyName: string;
    domain: string;
    industryType: string;
  };
}

export interface ServicesResponse {
  ok: boolean;
  timestamp: string;
  totalServices: number;
  runningServices: number;
  services: ServiceStatus[];
  serverUptime: number;
  serverPid: number;
}

export interface ChaosInjectionRequest {
  type: 'enable_errors' | 'enable_latency' | 'kill_service';
  target: string;
  intensity: number; // 1-10 scale
  duration?: number; // 0 = indefinite
}

export interface ChaosInjectionResponse {
  chaosId: string;
  type: string;
  target: string;
  injectedAt: string;
  revertInfo?: any;
}

export interface FeatureFlagResponse {
  globalFeatureFlags: {
    errors_per_transaction: number;
    errors_per_visit: number;
    errors_per_minute: number;
    regenerate_every_n_transactions: number;
  };
  serviceOverrides: Record<string, any>;
  targetedServices: string[];
}

/**
 * Fetch service status from BizObs server
 */
export async function getServiceStatus(): Promise<ServicesResponse> {
  const response = await fetch(`${BIZOBS_SERVER_URL}/api/admin/services/status`);
  if (!response.ok) {
    throw new Error(`Failed to fetch services: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Stop all services
 */
export async function stopAllServices(): Promise<{ ok: boolean; message: string }> {
  const response = await fetch(`${BIZOBS_SERVER_URL}/api/admin/services/stop-everything`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to stop services: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Inject chaos into a service
 */
export async function injectChaos(request: ChaosInjectionRequest): Promise<ChaosInjectionResponse> {
  const response = await fetch(`${BIZOBS_SERVER_URL}/api/gremlin/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`Failed to inject chaos: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Revert all chaos injections
 */
export async function revertAllChaos(): Promise<{ reverted: number; failed: number }> {
  const response = await fetch(`${BIZOBS_SERVER_URL}/api/gremlin/revert-all`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to revert chaos: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get feature flags (error rates, etc.)
 */
export async function getFeatureFlags(): Promise<FeatureFlagResponse> {
  const response = await fetch(`${BIZOBS_SERVER_URL}/api/feature_flag`);
  if (!response.ok) {
    throw new Error(`Failed to fetch feature flags: ${response.statusText}`);
  }
  const data = await response.json();
  return {
    globalFeatureFlags: data.flags || data.globalFeatureFlags,
    serviceOverrides: data.serviceOverrides || {},
    targetedServices: data.targetedServices || [],
  };
}

/**
 * Trigger Fix-It agent for a problem
 */
export async function triggerFixItAgent(problemId: string): Promise<any> {
  const response = await fetch(`${BIZOBS_SERVER_URL}/api/workflow-webhook/problem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_type: 'PROBLEM',
      problem_id: problemId,
      display_id: problemId,
      title: `Manual Fix-It trigger for ${problemId}`,
      workflow_name: 'BizObs AppEngine Manual Trigger',
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to trigger Fix-It agent: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get Fix-It agent status
 */
export async function getFixItStatus(): Promise<any> {
  const response = await fetch(`${BIZOBS_SERVER_URL}/api/autonomous/status`);
  if (!response.ok) {
    throw new Error(`Failed to get Fix-It status: ${response.statusText}`);
  }
  return response.json();
}
