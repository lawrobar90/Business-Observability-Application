import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Page } from '@dynatrace/strato-components-preview/layouts';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph, Strong } from '@dynatrace/strato-components/typography';
import { Button } from '@dynatrace/strato-components/buttons';
import { IntentButton } from '@dynatrace/strato-components-preview/buttons';
import { TextInput } from '@dynatrace/strato-components-preview/forms';
import { TitleBar } from '@dynatrace/strato-components-preview/layouts';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { appSettingsObjectsClient } from '@dynatrace-sdk/client-app-settings-v2';
import { edgeConnectClient } from '@dynatrace-sdk/client-app-engine-edge-connect';
import { functions } from '@dynatrace-sdk/app-utils';
import { getEnvironmentUrl } from '@dynatrace-sdk/app-environment';
import type { IntentPayload } from '@dynatrace-sdk/navigation';
import { generateCsuitePrompt, generateJourneyPrompt, PROMPT_DESCRIPTIONS } from '../constants/promptTemplates';
import { INITIAL_TEMPLATES, InitialTemplate } from '../constants/initialTemplates';

const LOCAL_STORAGE_KEY = 'bizobs_api_settings';

// Dynamic tenant URL — works in any environment
const TENANT_URL = (() => {
  try { return getEnvironmentUrl().replace(/\/$/, ''); } catch { return 'https://bko67471.sprint.apps.dynatracelabs.com'; }
})();
const TENANT_HOST = TENANT_URL.replace(/^https?:\/\//, '');
const TENANT_ID = TENANT_HOST.split('.')[0];
const SSO_ENDPOINT = TENANT_HOST.includes('sprint') || TENANT_HOST.includes('dynatracelabs')
  ? 'https://sso-sprint.dynatracelabs.com/sso/oauth2/token'
  : 'https://sso.dynatrace.com/sso/oauth2/token';

interface ApiSettingsFull {
  apiHost: string;
  apiPort: string;
  apiProtocol: string;
  enableAutoGeneration: boolean;
}

const DEFAULT_SETTINGS: ApiSettingsFull = {
  apiHost: 'localhost',
  apiPort: '8080',
  apiProtocol: 'http',
  enableAutoGeneration: false,
};

interface RunningService {
  service: string;
  running: boolean;
  pid: number;
  port?: number;
  companyName?: string;
  domain?: string;
  industryType?: string;
  stepName?: string;
  baseServiceName?: string;
  serviceVersion?: number;
  releaseStage?: string;
  startTime?: number;
}

interface PromptTemplate {
  id: string;
  name: string;
  companyName: string;
  domain: string;
  requirements: string;
  csuitePrompt: string;
  journeyPrompt: string;
  response?: string; // JSON response from Copilot
  originalConfig?: any; // Full config for pre-loaded templates
  createdAt: string;
  isPreloaded?: boolean;
}

const TEMPLATES_STORAGE_KEY = 'bizobs_prompt_templates';

export const HomePage = () => {
  const [activeTab, setActiveTab] = useState('welcome');
  const [companyName, setCompanyName] = useState('');
  const [domain, setDomain] = useState('');
  const [requirements, setRequirements] = useState('');
  const [copilotResponse, setCopilotResponse] = useState('');
  const [prompt1, setPrompt1] = useState('');
  const [prompt2, setPrompt2] = useState('');
  const [savedTemplates, setSavedTemplates] = useState<PromptTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [isGeneratingServices, setIsGeneratingServices] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ 
    appTemplates: false, 
    myTemplates: false 
  });
  const [apiSettings, setApiSettingsState] = useState({ host: 'localhost', port: '8080', protocol: 'http' });

  // Settings modal state
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsForm, setSettingsForm] = useState<ApiSettingsFull>(DEFAULT_SETTINGS);
  const [settingsObjectId, setSettingsObjectId] = useState<string | null>(null);
  const [settingsObjectVersion, setSettingsObjectVersion] = useState<string | null>(null);
  const [settingsUseLocalStorage, setSettingsUseLocalStorage] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [detectedCallerIp, setDetectedCallerIp] = useState<string | null>(null);

  // Services modal state
  const [showServicesModal, setShowServicesModal] = useState(false);
  const [runningServices, setRunningServices] = useState<RunningService[]>([]);
  const [isLoadingServices, setIsLoadingServices] = useState(false);
  const [isStoppingServices, setIsStoppingServices] = useState(false);
  const [stoppingCompany, setStoppingCompany] = useState<string | null>(null);
  const [servicesStatus, setServicesStatus] = useState('');

  // Dormant services state
  const [dormantServices, setDormantServices] = useState<any[]>([]);
  const [isLoadingDormant, setIsLoadingDormant] = useState(false);
  const [isClearingDormant, setIsClearingDormant] = useState(false);
  const [showDormantWarning, setShowDormantWarning] = useState<string | null>(null); // company name or 'all'
  const [clearingDormantCompany, setClearingDormantCompany] = useState<string | null>(null);

  // Settings modal tab state
  const [settingsTab, setSettingsTab] = useState<'config' | 'guide' | 'edgeconnect'>('config');

  // EdgeConnect state
  const [edgeConnects, setEdgeConnects] = useState<any[]>([]);
  const [isLoadingEC, setIsLoadingEC] = useState(false);
  const [ecStatus, setEcStatus] = useState('');
  const [isDeletingEC, setIsDeletingEC] = useState<string | null>(null);
  const [ecMatchResult, setEcMatchResult] = useState<{ matched: boolean; name?: string; pattern?: string } | null>(null);
  const [isCheckingMatch, setIsCheckingMatch] = useState(false);
  const [isCreatingEC, setIsCreatingEC] = useState(false);
  // EdgeConnect config inputs (for YAML generation & verification)
  const [ecName, setEcName] = useState('bizobs');
  const [ecHostPattern, setEcHostPattern] = useState('');
  const [ecClientId, setEcClientId] = useState('');
  const [ecClientSecret, setEcClientSecret] = useState('');

  // Tooltip state for header buttons
  const [showServicesTooltip, setShowServicesTooltip] = useState(false);
  const [showSettingsTooltip, setShowSettingsTooltip] = useState(false);
  const [showChaosTooltip, setShowChaosTooltip] = useState(false);

  // Chaos Gremlin Agent modal state
  const [showChaosModal, setShowChaosModal] = useState(false);
  const [chaosTab, setChaosTab] = useState<'active' | 'inject' | 'targeted' | 'smart'>('active');
  const [activeFaults, setActiveFaults] = useState<any[]>([]);
  const [chaosRecipes, setChaosRecipes] = useState<any[]>([]);
  const [targetedServices, setTargetedServices] = useState<Record<string, any>>({});
  const [isLoadingChaos, setIsLoadingChaos] = useState(false);
  const [chaosStatus, setChaosStatus] = useState('');
  const [isInjectingChaos, setIsInjectingChaos] = useState(false);
  const [isRevertingChaos, setIsRevertingChaos] = useState(false);
  const [smartChaosGoal, setSmartChaosGoal] = useState('');
  const [isSmartChaosRunning, setIsSmartChaosRunning] = useState(false);
  const [injectTargetMode, setInjectTargetMode] = useState<'service' | 'journey'>('service');
  const [injectForm, setInjectForm] = useState({ type: 'enable_errors', target: '', company: '', intensity: 5, duration: 60 });

  // Step 2 guided sub-step state
  const [step2Phase, setStep2Phase] = useState<'prompts' | 'response' | 'generate'>(  'prompts');

  // Toast notification state
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning' | 'info'>('info');
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Confirm dialog state (replaces native confirm())
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);

  // Get Started checklist state
  const [showGetStartedModal, setShowGetStartedModal] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('bizobs_checklist') || '{}'); } catch { return {}; }
  });
  const toggleCheck = (key: string) => {
    setChecklist(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem('bizobs_checklist', JSON.stringify(next));
      return next;
    });
  };
  const checklistSteps = [
    { key: 'server-ip', label: 'Configure Server IP', section: 'server' },
    { key: 'edgeconnect-create', label: 'Create EdgeConnect in Dynatrace', section: 'network' },
    { key: 'edgeconnect-deploy', label: 'Deploy EdgeConnect on Server', section: 'network' },
    { key: 'edgeconnect-online', label: 'Verify EdgeConnect is Online', section: 'network' },
    { key: 'oneagent', label: 'OneAgent Installed on Host', section: 'monitoring' },
    { key: 'test-connection', label: 'Test Connection from App', section: 'verify' },
    { key: 'openpipeline', label: 'OpenPipeline Configuration', section: 'config' },
    { key: 'biz-events', label: 'Business Event Capture Rules', section: 'config' },
    { key: 'feature-flags', label: 'OneAgent Feature Flags', section: 'config' },
  ];

  // Auto-detected checklist state (merged with manual checks)
  // These are computed from live state and override manual toggles
  const autoDetected: Record<string, boolean> = {
    'server-ip': !!(apiSettings.host && apiSettings.host !== ''),
    'edgeconnect-create': edgeConnects.length > 0,
    'edgeconnect-deploy': edgeConnects.some((ec: any) => (ec.metadata?.instances || []).length > 0),
    'edgeconnect-online': edgeConnects.some((ec: any) => (ec.metadata?.instances || []).length > 0),
    'test-connection': ecMatchResult?.matched === true,
  };
  const isStepComplete = (key: string) => autoDetected[key] || checklist[key];
  const completedCount = checklistSteps.filter(s => isStepComplete(s.key)).length;
  const totalSteps = checklistSteps.length;

  /** Show toast notification at bottom of app */
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', duration = 4000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    setToastType(type);
    setToastVisible(true);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), duration);
  }, []);

  /** Build IntentPayload for Notebook button — tags query for view-query intent */
  const getNotebookPayload = useCallback((services: RunningService[]): IntentPayload => {
    const serviceNames = services.map(s => `"${(s.baseServiceName || s.service).toLowerCase()}"`).join(', ');

    // Service tags table (smartscapeNodes with dynamic tag parsing)
    const tagQuery = [
      `smartscapeNodes SERVICE`,
      `| filter in(entity.name, array(${serviceNames}))`,
      `| fields entity.name, cnt=1, tags=toString(tags)`,
      `| parse tags, "'{' ARRAY{STRUCTURE{DQS:tag ':' JSON_VALUE:value (', '|'}')}:i}{1,}:parsedTags"`,
      `| expand parsedTags`,
      `| filterOut isNull(parsedTags)`,
      `| summarize {tcnt=count()}, by: {entity.name, tag=parsedTags[tag]}`,
      `| summarize {tags=collectArray(record(tag,tcnt))}, by:{entity.name}`,
      `| fieldsAdd tags=toString(arraySort(tags))`,
      `| parse tags, """'[' KVP{ '{\\"tag\\":\\\"' LD:key '\\", \\"tcnt\\":' JSON_VALUE:value ('}, '|'}]')}:tags"""`,
      `| fieldsFlatten tags, prefix:"tag."`,
      `| fieldsRemove tags`,
      `| sort entity.name asc`,
    ].join('\n');

    return { 'dt.query': tagQuery };
  }, []);

  // Load saved templates from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TEMPLATES_STORAGE_KEY);
      if (stored) {
        setSavedTemplates(JSON.parse(stored));
      } else {
        // First time running - load initial templates from saved-configs
        const initialTemplates = INITIAL_TEMPLATES.map(t => ({
          ...t,
          // Generate prompts on demand when loaded
          csuitePrompt: t.csuitePrompt || '',
          journeyPrompt: t.journeyPrompt || ''
        }));
        setSavedTemplates(initialTemplates);
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(initialTemplates));
        console.log(`✅ Loaded ${initialTemplates.length} initial templates`);
      }
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  }, []);

  // Load API settings from Dynatrace tenant on mount
  useEffect(() => {
    const loadApiSettings = async () => {
      try {
        const result = await appSettingsObjectsClient.getEffectiveAppSettingsValues({
          schemaId: 'app:my.bizobs.generator:api-config',
          addFields: 'value',
        });
        if (result.items && result.items.length > 0) {
          const v = result.items[0].value as any;
          const loaded = {
            apiHost: v?.apiHost || 'localhost',
            apiPort: v?.apiPort || '8080',
            apiProtocol: v?.apiProtocol || 'http',
            enableAutoGeneration: v?.enableAutoGeneration || false,
          };
          setApiSettingsState({ host: loaded.apiHost, port: loaded.apiPort, protocol: loaded.apiProtocol });
          setSettingsForm(loaded);
          // Also get objectId/version for updates
          try {
            const objects = await appSettingsObjectsClient.getAppSettingsObjects({
              schemaId: 'app:my.bizobs.generator:api-config',
              addFields: 'value,objectId,version',
            });
            if (objects.items && objects.items.length > 0) {
              setSettingsObjectId(objects.items[0].objectId);
              setSettingsObjectVersion(objects.items[0].version || null);
            }
          } catch (e) { /* no objects yet */ }
          return;
        }
      } catch (e) {
        setSettingsUseLocalStorage(true);
      }
      try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
          const p = JSON.parse(stored);
          const loaded = {
            apiHost: p.apiHost || 'localhost',
            apiPort: p.apiPort || '8080',
            apiProtocol: p.apiProtocol || 'http',
            enableAutoGeneration: p.enableAutoGeneration || false,
          };
          setApiSettingsState({ host: loaded.apiHost, port: loaded.apiPort, protocol: loaded.apiProtocol });
          setSettingsForm(loaded);
        }
      } catch (e) { /* use defaults */ }
    };
    loadApiSettings();
  }, []);

  // ── EdgeConnect Logic ──────────────────────────────────
  const loadEdgeConnects = async () => {
    setIsLoadingEC(true);
    setEcStatus('');
    try {
      const result = await edgeConnectClient.listEdgeConnects({ addFields: 'metadata' });
      setEdgeConnects(result.edgeConnects || []);
    } catch (err: any) {
      setEcStatus(`❌ Failed to load EdgeConnects: ${err.message}`);
      setEdgeConnects([]);
    }
    setIsLoadingEC(false);
  };

  const deleteEdgeConnect = async (ecId: string, ecName: string) => {
    if (!confirm(`Delete EdgeConnect "${ecName}"? This cannot be undone.`)) return;
    setIsDeletingEC(ecId);
    setEcStatus(`🗑️ Deleting ${ecName}...`);
    try {
      await edgeConnectClient.deleteEdgeConnect({ edgeConnectId: ecId });
      setEcStatus(`✅ Deleted "${ecName}"`);
      await loadEdgeConnects();
    } catch (err: any) {
      setEcStatus(`❌ Failed to delete: ${err.message}`);
    }
    setIsDeletingEC(null);
  };

  // Create EdgeConnect via SDK — auto-generates OAuth credentials
  const createEdgeConnect = async () => {
    const name = ecName.trim();
    const host = (ecHostPattern.trim() || settingsForm.apiHost || '').trim();
    if (!name || !host) {
      setEcStatus('❌ Name and host pattern / IP are required');
      return;
    }
    setIsCreatingEC(true);
    setEcStatus('⏳ Creating EdgeConnect & generating credentials...');
    try {
      const proxyRes = await functions.call('proxy-api', {
        data: {
          action: 'ec-create',
          apiHost: '', apiPort: '', apiProtocol: '',
          body: { ecName: name, hostPatterns: [host] },
        },
      });
      const result = await proxyRes.json() as any;
      if (!result.success) {
        const rawErr = result.debug?.rawError || '';
        if (rawErr.includes('already exist') || rawErr.includes('constraintViolations')) {
          setEcStatus('⚠️ An EdgeConnect with that name or host pattern already exists. Delete it first (below) or use different values.');
        } else {
          setEcStatus(`❌ ${result.error}`);
        }
        setIsCreatingEC(false);
        return;
      }
      // Auto-populate the credentials from SDK response
      setEcClientId(result.data?.oauthClientId || '');
      setEcClientSecret(result.data?.oauthClientSecret || '');
      setEcStatus('✅ EdgeConnect created! Credentials auto-filled below. Copy the YAML and deploy on your server.');
      await loadEdgeConnects();
      await checkEdgeConnectMatch();
    } catch (err: any) {
      setEcStatus(`❌ Failed: ${err.message}`);
    }
    setIsCreatingEC(false);
  };

  // Generate YAML from EdgeConnect credentials
  const generateEcYaml = () => {
    return `name: ${ecName.trim() || 'bizobs'}\napi_endpoint_host: ${TENANT_HOST}\noauth:\n  client_id: ${ecClientId.trim() || '<your-client-id>'}\n  client_secret: ${ecClientSecret.trim() || '<your-client-secret>'}\n  resource: urn:dtenvironment:${TENANT_ID}\n  endpoint: ${SSO_ENDPOINT}`;
  };

  // Derived: is any EdgeConnect online?
  const isAnyEcOnline = edgeConnects.some((ec: any) => (ec.metadata?.instances || []).length > 0);
  // Derived: is EdgeConnect route matched?
  const isEcRouteActive = ecMatchResult?.matched === true;

  const checkEdgeConnectMatch = async () => {
    const host = ecHostPattern || apiSettings.host || 'localhost';
    const port = apiSettings.port || '8080';
    const proto = apiSettings.protocol || 'http';
    setIsCheckingMatch(true);
    setEcMatchResult(null);
    try {
      const result = await edgeConnectClient.getMatchedEdgeConnects({ url: `${proto}://${host}:${port}/api/health` });
      if (result.matched) {
        setEcMatchResult({ matched: true, name: result.matched.name, pattern: result.matched.matchedPattern });
      } else {
        setEcMatchResult({ matched: false });
      }
    } catch (err: any) {
      setEcMatchResult({ matched: false });
    }
    setIsCheckingMatch(false);
  };

  // ── Settings Modal Logic ──────────────────────────────────
  const openSettingsModal = () => {
    setSettingsForm({
      apiHost: apiSettings.host,
      apiPort: apiSettings.port,
      apiProtocol: apiSettings.protocol,
      enableAutoGeneration: settingsForm.enableAutoGeneration,
    });
    setSettingsStatus('');
    setShowSettingsModal(true);

  };

  const saveSettingsFromModal = async () => {
    setIsSavingSettings(true);
    setSettingsStatus('💾 Saving...');

    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settingsForm));
    localStorage.setItem('bizobs_api_host', settingsForm.apiHost);
    localStorage.setItem('bizobs_api_port', settingsForm.apiPort);

    if (!settingsUseLocalStorage) {
      try {
        if (settingsObjectId && settingsObjectVersion) {
          await appSettingsObjectsClient.putAppSettingsObjectByObjectId({
            objectId: settingsObjectId,
            optimisticLockingVersion: settingsObjectVersion,
            body: { value: settingsForm },
          });
        } else {
          await appSettingsObjectsClient.postAppSettingsObject({
            body: { schemaId: 'app:my.bizobs.generator:api-config', value: settingsForm },
          });
        }
        setSettingsStatus('✅ Saved to Dynatrace tenant!');
      } catch (error: any) {
        setSettingsStatus(`⚠️ Saved locally. Tenant save failed: ${error.message}`);
      }
    } else {
      setSettingsStatus('✅ Saved locally!');
    }

    setApiSettingsState({ host: settingsForm.apiHost, port: settingsForm.apiPort, protocol: settingsForm.apiProtocol });
    setIsSavingSettings(false);
    setTimeout(() => setShowSettingsModal(false), 600);
  };

  const testConnectionFromModal = async () => {
    setIsTestingConnection(true);
    setSettingsStatus('🔄 Testing connection...');
    try {
      const proxyResponse = await functions.call('proxy-api', {
        data: { action: 'test-connection', apiHost: settingsForm.apiHost, apiPort: settingsForm.apiPort, apiProtocol: settingsForm.apiProtocol },
      });
      const result = await proxyResponse.json() as any;
      // Capture caller IP reported by the BizObs server (the actual source IP that reached it)
      if (result.callerIp) setDetectedCallerIp(result.callerIp);
      if (result.success) {
        const ipNote = result.callerIp ? ` (source IP: ${result.callerIp})` : '';
        setSettingsStatus(`✅ ${result.message}${ipNote}`);
      } else {
        setSettingsStatus(`❌ ${result.error || result.details}`);
      }
    } catch (error: any) {
      setSettingsStatus(`❌ ${error.message}`);
    }
    setIsTestingConnection(false);
  };

  // ── Services Modal Logic ──────────────────────────────────
  const openServicesModal = async () => {
    setShowServicesModal(true);
    setServicesStatus('');
    await Promise.all([loadRunningServices(), loadDormantServices()]);
  };

  const loadRunningServices = async () => {
    setIsLoadingServices(true);
    try {
      const proxyResponse = await functions.call('proxy-api', {
        data: { action: 'get-services', apiHost: apiSettings.host, apiPort: apiSettings.port, apiProtocol: apiSettings.protocol },
      });
      const result = await proxyResponse.json() as any;
      if (result.success && result.data?.childServices) {
        setRunningServices(result.data.childServices);
        setServicesStatus(result.data.childServices.length > 0
          ? `${result.data.childServices.length} service(s) running`
          : 'No services running');
      } else {
        setRunningServices([]);
        setServicesStatus('Could not retrieve services');
      }
    } catch (error: any) {
      setRunningServices([]);
      setServicesStatus(`❌ ${error.message}`);
    }
    setIsLoadingServices(false);
  };

  const stopAllServices = async () => {
    setConfirmDialog({
      message: '⚠️ Stop ALL running services? This will kill every child service on the server.',
      onConfirm: () => doStopAllServices()
    });
  };

  const doStopAllServices = async () => {
    setIsStoppingServices(true);
    setServicesStatus('🛑 Stopping all services...');
    try {
      const proxyResponse = await functions.call('proxy-api', {
        data: { action: 'stop-all-services', apiHost: apiSettings.host, apiPort: apiSettings.port, apiProtocol: apiSettings.protocol },
      });
      const result = await proxyResponse.json() as any;
      setServicesStatus(result.success ? '✅ All services stopped!' : `❌ ${result.data?.error || 'Failed'}`);
      await Promise.all([loadRunningServices(), loadDormantServices()]);
    } catch (error: any) {
      setServicesStatus(`❌ ${error.message}`);
    }
    setIsStoppingServices(false);
  };

  const stopCompanyServices = async (company: string) => {
    setIsStoppingServices(true);
    setStoppingCompany(company);
    setServicesStatus(`🛑 Stopping services for ${company}...`);
    try {
      const proxyResponse = await functions.call('proxy-api', {
        data: { action: 'stop-company-services', apiHost: apiSettings.host, apiPort: apiSettings.port, apiProtocol: apiSettings.protocol, body: { companyName: company } },
      });
      const result = await proxyResponse.json() as any;
      setServicesStatus(result.success ? `✅ Stopped ${result.data?.stoppedServices?.length || 0} service(s) for ${company}` : `❌ ${result.data?.error || 'Failed'}`);
      await Promise.all([loadRunningServices(), loadDormantServices()]);
    } catch (error: any) {
      setServicesStatus(`❌ ${error.message}`);
    }
    setStoppingCompany(null);
    setIsStoppingServices(false);
  };

  // ── Dormant Services Logic ────────────────────────────────
  const loadDormantServices = async () => {
    setIsLoadingDormant(true);
    try {
      const proxyResponse = await functions.call('proxy-api', {
        data: { action: 'get-dormant-services', apiHost: apiSettings.host, apiPort: apiSettings.port, apiProtocol: apiSettings.protocol },
      });
      const result = await proxyResponse.json() as any;
      if (result.success && result.data?.dormantServices) {
        setDormantServices(result.data.dormantServices);
      } else {
        setDormantServices([]);
      }
    } catch {
      setDormantServices([]);
    }
    setIsLoadingDormant(false);
  };

  const clearAllDormantServices = async () => {
    setIsClearingDormant(true);
    try {
      await functions.call('proxy-api', {
        data: { action: 'clear-dormant-services', apiHost: apiSettings.host, apiPort: apiSettings.port, apiProtocol: apiSettings.protocol },
      });
      setServicesStatus('🧹 Dormant services cleared');
      await loadDormantServices();
    } catch (error: any) {
      setServicesStatus(`❌ ${error.message}`);
    }
    setIsClearingDormant(false);
    setShowDormantWarning(null);
  };

  const clearCompanyDormantServices = async (company: string) => {
    setClearingDormantCompany(company);
    try {
      await functions.call('proxy-api', {
        data: { action: 'clear-company-dormant', apiHost: apiSettings.host, apiPort: apiSettings.port, apiProtocol: apiSettings.protocol, body: { companyName: company } },
      });
      setServicesStatus(`🧹 Dormant services cleared for ${company}`);
      await loadDormantServices();
    } catch (error: any) {
      setServicesStatus(`❌ ${error.message}`);
    }
    setClearingDormantCompany(null);
    setShowDormantWarning(null);
  };

  // ── Chaos Agent Modal Logic ──────────────────────────────────
  const chaosProxy = async (action: string, body?: any) => {
    const res = await functions.call('proxy-api', {
      data: { action, apiHost: apiSettings.host, apiPort: apiSettings.port, apiProtocol: apiSettings.protocol, body },
    });
    return await res.json() as any;
  };

  const openChaosModal = async () => {
    setShowChaosModal(true);
    setChaosStatus('');
    setChaosTab('active');
    await loadChaosData();
  };

  const loadChaosData = async () => {
    setIsLoadingChaos(true);
    try {
      const [activeRes, recipesRes, targetedRes] = await Promise.all([
        chaosProxy('chaos-get-active'),
        chaosProxy('chaos-get-recipes'),
        chaosProxy('chaos-get-targeted'),
      ]);
      if (activeRes.success) setActiveFaults(activeRes.data?.activeFaults || activeRes.data || []);
      if (recipesRes.success) setChaosRecipes(activeRes.data?.recipes || recipesRes.data?.recipes || recipesRes.data || []);
      if (targetedRes.success) setTargetedServices(targetedRes.data?.serviceOverrides || targetedRes.data || {});
    } catch (error: any) {
      setChaosStatus(`❌ ${error.message}`);
    }
    setIsLoadingChaos(false);
  };

  const injectChaos = async () => {
    if (injectTargetMode === 'service' && !injectForm.target) { setChaosStatus('⚠️ Select a target service'); return; }
    if (injectTargetMode === 'journey' && !injectForm.company) { setChaosStatus('⚠️ Select a journey (company)'); return; }
    setIsInjectingChaos(true);
    const targetLabel = injectTargetMode === 'service' ? injectForm.target : `${injectForm.company} (all services)`;
    setChaosStatus(`💉 Injecting chaos on ${targetLabel}...`);
    try {
      const payload = injectTargetMode === 'service'
        ? { type: injectForm.type, target: injectForm.target, intensity: injectForm.intensity, duration: injectForm.duration }
        : { type: injectForm.type, target: 'default', company: injectForm.company, intensity: injectForm.intensity, duration: injectForm.duration };
      const result = await chaosProxy('chaos-inject', payload);
      if (result.success) {
        setChaosStatus(`✅ Chaos injected: ${injectForm.type} on ${targetLabel} (intensity ${injectForm.intensity}, ${injectForm.duration}s)`);
        showToast(`💉 Gremlin injected on ${targetLabel}`, 'warning', 5000);
        await loadChaosData();
      } else {
        setChaosStatus(`❌ ${result.data?.error || result.error || 'Injection failed'}`);
      }
    } catch (error: any) {
      setChaosStatus(`❌ ${error.message}`);
    }
    setIsInjectingChaos(false);
  };

  const revertFault = async (faultId: string) => {
    setIsRevertingChaos(true);
    setChaosStatus('🔄 Reverting fault...');
    try {
      const result = await chaosProxy('chaos-revert', { faultId });
      if (result.success) {
        setChaosStatus('✅ Fault reverted');
        showToast('✅ Chaos fault reverted', 'success');
        await loadChaosData();
      } else {
        setChaosStatus(`❌ ${result.data?.error || 'Revert failed'}`);
      }
    } catch (error: any) {
      setChaosStatus(`❌ ${error.message}`);
    }
    setIsRevertingChaos(false);
  };

  const revertAllFaults = async () => {
    setIsRevertingChaos(true);
    setChaosStatus('🔄 Reverting all faults...');
    try {
      const result = await chaosProxy('chaos-revert-all');
      if (result.success) {
        setChaosStatus('✅ All faults reverted');
        showToast('✅ All chaos faults reverted', 'success');
        await loadChaosData();
      } else {
        setChaosStatus(`❌ ${result.data?.error || 'Revert failed'}`);
      }
    } catch (error: any) {
      setChaosStatus(`❌ ${error.message}`);
    }
    setIsRevertingChaos(false);
  };

  const removeTargetedService = async (serviceName: string) => {
    try {
      const result = await chaosProxy('chaos-remove-target', { serviceName });
      if (result.success) {
        setChaosStatus(`✅ Removed override for ${serviceName}`);
        showToast(`✅ ${serviceName} error override removed`, 'success');
        await loadChaosData();
      } else {
        setChaosStatus(`❌ ${result.data?.error || 'Remove failed'}`);
      }
    } catch (error: any) {
      setChaosStatus(`❌ ${error.message}`);
    }
  };

  const runSmartChaos = async () => {
    if (!smartChaosGoal.trim()) { setChaosStatus('⚠️ Enter a chaos goal'); return; }
    setIsSmartChaosRunning(true);
    setChaosStatus('🤖 Gremlin AI analysing and injecting chaos...');
    try {
      const result = await chaosProxy('chaos-smart', { goal: smartChaosGoal });
      if (result.success && result.data) {
        const d = result.data;
        setChaosStatus(`✅ Gremlin AI: ${d.type || 'injected'} on ${d.target || 'auto'} (intensity ${d.intensity || '?'})`);
        showToast(`👹 Gremlin unleashed: ${d.type || 'auto'}`, 'warning', 5000);
        setSmartChaosGoal('');
        await loadChaosData();
      } else {
        setChaosStatus(`❌ ${result.data?.error || result.error || 'Smart chaos failed'}`);
      }
    } catch (error: any) {
      setChaosStatus(`❌ ${error.message}`);
    }
    setIsSmartChaosRunning(false);
  };

  // openNotebookForCompany replaced by IntentButton + getNotebookPayload helper

  // Generate prompts when moving to step 2
  useEffect(() => {
    if (activeTab === 'step2' && companyName && domain) {
      const csuite = generateCsuitePrompt({ companyName, domain, requirements });
      const journey = generateJourneyPrompt({ companyName, domain, requirements });
      setPrompt1(csuite);
      setPrompt2(journey);
    }
  }, [activeTab, companyName, domain, requirements]);

  const copyToClipboard = (text: string, promptName: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${promptName} copied to clipboard!`, 'success', 2500);
  };

  const processResponse = async () => {
    if (!copilotResponse.trim()) {
      showToast('Please paste the AI response before proceeding.', 'warning');
      return;
    }
    
    try {
      const parsedResponse = JSON.parse(copilotResponse);
      setGenerationStatus('✅ JSON validated successfully');
      
      // Check if it looks like a journey config
      if (!parsedResponse.journey && !parsedResponse.steps) {
        showToast('Response is valid JSON, but might be missing journey data. Expected "journey" or "steps" field.', 'warning', 6000);
        return;
      }
      
      showToast('Response validated! JSON is ready for service generation.', 'success');
    } catch (error) {
      showToast('Invalid JSON response. Please check the format and try again.', 'error');
      setGenerationStatus('❌ JSON validation failed');
    }
  };

  const generateServices = async () => {
    if (!copilotResponse.trim()) {
      showToast('Please paste the AI response before generating services.', 'warning');
      return;
    }

    try {
      setIsGeneratingServices(true);
      setGenerationStatus('🔄 Parsing journey data...');
      
      const parsedResponse = JSON.parse(copilotResponse);
      
      // Validate journey structure
      if (!parsedResponse.journey && !parsedResponse.steps) {
        throw new Error('Missing journey or steps data in response');
      }

      setGenerationStatus(`🚀 Creating services on ${apiSettings.host}:${apiSettings.port}...`);
      
      // Call via serverless proxy function (bypasses CSP)
      const proxyResponse = await functions.call('proxy-api', {
        data: {
          action: 'simulate-journey',
          apiHost: apiSettings.host,
          apiPort: apiSettings.port,
          apiProtocol: apiSettings.protocol,
          body: parsedResponse,
        },
      });

      const result = await proxyResponse.json() as any;

      if (!result.success) {
        throw new Error(result.error || `API call failed (status ${result.status})`);
      }

      const data = result.data as any;
      const journey = data?.journey;
      const jId = journey?.journeyId || data?.journeyId || 'N/A';
      const jCompany = journey?.steps?.[0]?.companyName || data?.companyName || companyName;
      setGenerationStatus(`✅ Services created successfully! Journey ID: ${jId}`);
      showToast(`Services generated! Journey: ${jId} • Company: ${jCompany}`, 'success', 6000);
      
    } catch (error: any) {
      console.error('Service generation error:', error);
      setGenerationStatus(`❌ Failed: ${error.message}`);
      showToast(`Failed to generate services: ${error.message}`, 'error', 8000);
    } finally {
      setIsGeneratingServices(false);
    }
  };

  const saveTemplate = () => {
    if (!templateName.trim()) {
      showToast('Please enter a template name.', 'warning');
      return;
    }

    const newTemplate: PromptTemplate = {
      id: `template_${Date.now()}`,
      name: templateName,
      companyName,
      domain,
      requirements,
      csuitePrompt: prompt1,
      journeyPrompt: prompt2,
      response: copilotResponse, // Save the JSON response
      createdAt: new Date().toISOString(),
      isPreloaded: false // User-created template
    };

    const updated = [...savedTemplates, newTemplate];
    setSavedTemplates(updated);
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
    setTemplateName('');
    setShowSaveDialog(false);
    showToast(`Template "${templateName}" saved!`, 'success');
  };

  const loadTemplate = (templateId: string) => {
    const template = savedTemplates.find(t => t.id === templateId);
    if (template) {
      setCompanyName(template.companyName);
      setDomain(template.domain);
      setRequirements(template.requirements);
      setPrompt1(template.csuitePrompt);
      setPrompt2(template.journeyPrompt);
      // Load response - either from response field or originalConfig
      if (template.response) {
        setCopilotResponse(template.response);
      } else if (template.originalConfig) {
        // For pre-loaded templates, check for copilotResponseStep2 field
        const configResponse = template.originalConfig.copilotResponseStep2 
          || template.originalConfig.copilotResponse 
          || JSON.stringify(template.originalConfig, null, 2);
        setCopilotResponse(configResponse);
      } else {
        setCopilotResponse('');
      }
      setSelectedTemplate(templateId);
      setActiveTab('step1'); // Navigate to step 1 to see the loaded data
    }
  };

  const deleteTemplate = (templateId: string) => {
    setConfirmDialog({
      message: 'Are you sure you want to delete this template?',
      onConfirm: () => {
        const updated = savedTemplates.filter(t => t.id !== templateId);
        setSavedTemplates(updated);
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
        if (selectedTemplate === templateId) {
          setSelectedTemplate('');
        }
        showToast('Template deleted.', 'success');
      }
    });
  };

  const exportTemplate = (templateId: string) => {
    const template = savedTemplates.find(t => t.id === templateId);
    if (template) {
      const dataStr = JSON.stringify(template, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${template.companyName.replace(/\s+/g, '-')}-${template.name.replace(/\s+/g, '-')}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const exportAllTemplates = () => {
    const dataStr = JSON.stringify(savedTemplates, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `all-templates-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importTemplates = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const imported = JSON.parse(content);
        
        // Check if it's a single template or array
        const templates = Array.isArray(imported) ? imported : [imported];
        
        // Merge with existing templates, avoiding duplicates
        const merged = [...savedTemplates];
        templates.forEach((t: PromptTemplate) => {
          if (!merged.find(existing => existing.id === t.id)) {
            merged.push(t);
          }
        });
        
        setSavedTemplates(merged);
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(merged));
        showToast(`Imported ${templates.length} template(s) successfully!`, 'success');
      } catch (error) {
        showToast('Failed to import templates. Please check the file format.', 'error');
      }
    };
    reader.readAsText(file);
  };

  // Separate pre-loaded and user-created templates
  const preloadedTemplates = savedTemplates.filter(t => t.isPreloaded);
  const userTemplates = savedTemplates.filter(t => !t.isPreloaded);

  // Group templates by company name
  const groupTemplatesByCompany = (templates: PromptTemplate[]) => {
    return templates.reduce((acc, template) => {
      const company = template.companyName || 'Uncategorized';
      if (!acc[company]) {
        acc[company] = [];
      }
      acc[company].push(template);
      return acc;
    }, {} as Record<string, PromptTemplate[]>);
  };

  const preloadedByCompany = groupTemplatesByCompany(preloadedTemplates);
  const userTemplatesByCompany = groupTemplatesByCompany(userTemplates);

  const [expandedCompanies, setExpandedCompanies] = useState<Record<string, boolean>>({});

  const toggleCompany = (company: string) => {
    setExpandedCompanies(prev => ({
      ...prev,
      [company]: !prev[company]
    }));
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const renderSidebar = () => (
    <div style={{
      width: 260,
      height: '100%',
      position: 'relative',
      background: Colors.Background.Surface.Default,
      borderRight: `2px solid ${Colors.Border.Neutral.Default}`,
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0
    }}>
      {/* Sidebar Header */}
      <div style={{ 
        padding: 16,
        borderBottom: `2px solid ${Colors.Border.Neutral.Default}`,
        background: `linear-gradient(135deg, ${Colors.Theme.Primary['70']}, rgba(0, 212, 255, 0.8))`,
      }}>
        <Flex alignItems="center" gap={8} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 22 }}>📁</div>
          <Heading level={5} style={{ marginBottom: 0, color: 'white' }}>Template Library</Heading>
        </Flex>
        <Paragraph style={{ fontSize: 10, marginBottom: 0, color: 'rgba(255,255,255,0.9)', lineHeight: 1.4 }}>
          {preloadedTemplates.length} Preset • {userTemplates.length} Custom
        </Paragraph>
      </div>

      {/* Save Current Button */}
      <div style={{ padding: 12, borderBottom: `1px solid ${Colors.Border.Neutral.Default}` }}>
        <Button 
          variant="emphasized"
          onClick={() => setShowSaveDialog(true)}
          disabled={!companyName || !domain}
          style={{ width: '100%', marginBottom: 6 }}
        >
          💾 Save to My Templates
        </Button>
        <Flex gap={6}>
          <label style={{ flex: 1 }}>
            <Button style={{ width: '100%', fontSize: 11, padding: '6px' }}>📥 Import</Button>
            <input type="file" accept=".json" onChange={importTemplates} style={{ display: 'none' }} />
          </label>
          <Button onClick={exportAllTemplates} disabled={savedTemplates.length === 0} style={{ flex: 1, fontSize: 11, padding: '6px' }}>📤 Export</Button>
        </Flex>
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div style={{ 
          padding: 16,
          background: 'rgba(108, 44, 156, 0.15)',
          borderBottom: `2px solid ${Colors.Theme.Primary['70']}`
        }}>
          <Heading level={6} style={{ marginBottom: 12 }}>Save New Template</Heading>
          <TextInput 
            value={templateName}
            onChange={(value) => setTemplateName(value)}
            placeholder="Template name..."
            style={{ marginBottom: 8 }}
          />
          <Flex gap={8}>
            <Button variant="emphasized" onClick={saveTemplate} style={{ flex: 1 }}>Save</Button>
            <Button onClick={() => setShowSaveDialog(false)} style={{ flex: 1 }}>Cancel</Button>
          </Flex>
        </div>
      )}

      {/* Templates List - Separated by Type */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {/* App Templates Section */}
        <div style={{ marginBottom: 24 }}>
          <div 
            onClick={() => toggleSection('appTemplates')}
            style={{
              padding: 14,
              background: 'linear-gradient(135deg, rgba(0, 161, 201, 0.25), rgba(0, 161, 201, 0.15))',
              borderRadius: 10,
              border: '2px solid rgba(0, 161, 201, 0.6)',
              cursor: 'pointer',
              marginBottom: 12,
              boxShadow: '0 2px 8px rgba(0, 161, 201, 0.2)'
            }}
          >
            <Flex justifyContent="space-between" alignItems="center">
              <Flex alignItems="center" gap={12}>
                <div style={{ fontSize: 20 }}>{expandedSections.appTemplates ? '📂' : '📁'}</div>
                <div>
                  <Strong style={{ fontSize: 15, display: 'block' }}>🏛️ App Templates</Strong>
                  <Paragraph style={{ fontSize: 11, marginBottom: 0, marginTop: 2, opacity: 0.8 }}>
                    Preset templates included with the app
                  </Paragraph>
                </div>
              </Flex>
              <div style={{
                background: 'rgba(0, 161, 201, 0.8)',
                color: 'white',
                padding: '4px 12px',
                borderRadius: 14,
                fontSize: 12,
                fontWeight: 700
              }}>
                {preloadedTemplates.length}
              </div>
            </Flex>
          </div>

          {expandedSections.appTemplates && (
            <div style={{ paddingLeft: 8 }}>
              {Object.keys(preloadedByCompany).sort().map(company => (
            <div key={company} style={{ marginBottom: 16 }}>
              {/* Company Header */}
              <div 
                onClick={() => toggleCompany(company)}
                style={{
                  padding: 12,
                  background: `linear-gradient(135deg, rgba(108, 44, 156, 0.2), rgba(0, 212, 255, 0.1))`,
                  borderRadius: 8,
                  border: `1px solid ${Colors.Theme.Primary['70']}`,
                  cursor: 'pointer',
                  marginBottom: 8
                }}
              >
                <Flex justifyContent="space-between" alignItems="center">
                  <Flex alignItems="center" gap={8}>
                    <div style={{ fontSize: 16 }}>{expandedCompanies[company] ? '📂' : '📁'}</div>
                    <Strong style={{ fontSize: 14 }}>{company}</Strong>
                  </Flex>
                  <div style={{
                    background: Colors.Theme.Primary['70'],
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 600
                  }}>
                    {preloadedByCompany[company].length}
                  </div>
                </Flex>
              </div>

              {/* Templates under this company */}
              {expandedCompanies[company] && (
                <div style={{ paddingLeft: 8 }}>
                  {preloadedByCompany[company].map(template => (
                    <div 
                      key={template.id}
                      style={{
                        padding: 12,
                        marginBottom: 8,
                        background: selectedTemplate === template.id 
                          ? 'rgba(115, 190, 40, 0.2)' 
                          : Colors.Background.Base.Default,
                        borderRadius: 6,
                        border: `1px solid ${
                          selectedTemplate === template.id 
                            ? Colors.Theme.Success['70'] 
                            : Colors.Border.Neutral.Default
                        }`,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onClick={() => loadTemplate(template.id)}
                    >
                      <Flex alignItems="flex-start" gap={8}>
                        <div style={{ fontSize: 16, marginTop: 2 }}>
                          {selectedTemplate === template.id ? '✅' : '📄'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Strong style={{ 
                            fontSize: 13, 
                            display: 'block',
                            marginBottom: 4,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {template.name}
                          </Strong>
                          <Paragraph style={{ 
                            fontSize: 11, 
                            marginBottom: 4,
                            opacity: 0.7,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {template.domain}
                          </Paragraph>
                          <Paragraph style={{ fontSize: 10, marginBottom: 0, opacity: 0.5 }}>
                            {new Date(template.createdAt).toLocaleDateString()}
                          </Paragraph>
                        </div>
                      </Flex>
                      
                      {/* Action Buttons */}
                      <Flex gap={4} style={{ marginTop: 8 }}>
                        <Button 
                          onClick={(e) => {
                            e.stopPropagation();
                            loadTemplate(template.id);
                          }}
                          style={{ flex: 1, fontSize: 11, padding: '6px' }}
                        >
                          📂 Load
                        </Button>
                        <Button 
                          onClick={(e) => {
                            e.stopPropagation();
                            exportTemplate(template.id);
                          }}
                          style={{ flex: 1, fontSize: 11, padding: '6px' }}
                        >
                          📤 Export
                        </Button>
                        {!template.isPreloaded && (
                          <Button 
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteTemplate(template.id);
                            }}
                            style={{ fontSize: 11, padding: '6px' }}
                          >
                            🗑️
                          </Button>
                        )}
                      </Flex>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
            </div>
          )}
        </div>

        {/* My Templates Section */}
        <div style={{ marginBottom: 16 }}>
          <div 
            onClick={() => toggleSection('myTemplates')}
            style={{
              padding: 14,
              background: 'linear-gradient(135deg, rgba(108, 44, 156, 0.25), rgba(108, 44, 156, 0.15))',
              borderRadius: 10,
              border: '2px solid rgba(108, 44, 156, 0.6)',
              cursor: 'pointer',
              marginBottom: 12,
              boxShadow: '0 2px 8px rgba(108, 44, 156, 0.2)'
            }}
          >
            <Flex justifyContent="space-between" alignItems="center">
              <Flex alignItems="center" gap={12}>
                <div style={{ fontSize: 20 }}>{expandedSections.myTemplates ? '📂' : '📁'}</div>
                <div>
                  <Strong style={{ fontSize: 15, display: 'block' }}>✨ My Templates</Strong>
                  <Paragraph style={{ fontSize: 11, marginBottom: 0, marginTop: 2, opacity: 0.8 }}>
                    Templates you create and save
                  </Paragraph>
                </div>
              </Flex>
              <div style={{
                background: 'rgba(108, 44, 156, 0.8)',
                color: 'white',
                padding: '4px 12px',
                borderRadius: 14,
                fontSize: 12,
                fontWeight: 700
              }}>
                {userTemplates.length}
              </div>
            </Flex>
          </div>

          {expandedSections.myTemplates && (
            <div style={{ paddingLeft: 8 }}>
              {userTemplates.length === 0 ? (
                <div style={{
                  padding: 20,
                  textAlign: 'center',
                  background: 'rgba(108, 44, 156, 0.1)',
                  borderRadius: 8,
                  border: `1px dashed ${Colors.Border.Neutral.Default}`,
                  marginBottom: 12
                }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>✨</div>
                  <Paragraph style={{ fontSize: 12, marginBottom: 0, lineHeight: 1.5 }}>
                    <Strong>No custom templates yet</Strong><br/>
                    Click "💾 Save Current" above to create your first template!
                  </Paragraph>
                </div>
              ) : (
                Object.keys(userTemplatesByCompany).sort().map(company => (
                  <div key={company} style={{ marginBottom: 12 }}>
                    {/* Company Header */}
                    <div 
                      onClick={() => toggleCompany(`user_${company}`)}
                      style={{
                        padding: 12,
                        background: `linear-gradient(135deg, rgba(108, 44, 156, 0.2), rgba(0, 212, 255, 0.1))`,
                        borderRadius: 8,
                        border: `1px solid ${Colors.Theme.Primary['70']}`,
                        cursor: 'pointer',
                        marginBottom: 8
                      }}
                    >
                      <Flex justifyContent="space-between" alignItems="center">
                        <Flex alignItems="center" gap={8}>
                          <div style={{ fontSize: 16 }}>{expandedCompanies[`user_${company}`] ? '📂' : '📁'}</div>
                          <Strong style={{ fontSize: 14 }}>{company}</Strong>
                        </Flex>
                        <div style={{
                          background: Colors.Theme.Primary['70'],
                          color: 'white',
                          padding: '2px 8px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 600
                        }}>
                          {userTemplatesByCompany[company].length}
                        </div>
                      </Flex>
                    </div>

                    {/* Templates under this company */}
                    {expandedCompanies[`user_${company}`] && (
                      <div style={{ paddingLeft: 8 }}>
                        {userTemplatesByCompany[company].map(template => (
                          <div 
                            key={template.id}
                            style={{
                              padding: 12,
                              marginBottom: 8,
                              background: selectedTemplate === template.id 
                                ? 'rgba(115, 190, 40, 0.2)' 
                                : Colors.Background.Base.Default,
                              borderRadius: 6,
                              border: `1px solid ${
                                selectedTemplate === template.id 
                                  ? Colors.Theme.Success['70'] 
                                  : Colors.Border.Neutral.Default
                              }`,
                              cursor: 'pointer',
                              transition: 'all 0.2s ease'
                            }}
                            onClick={() => loadTemplate(template.id)}
                          >
                            <Flex alignItems="flex-start" gap={8}>
                              <div style={{ fontSize: 16, marginTop: 2 }}>
                                {selectedTemplate === template.id ? '✅' : '📄'}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <Strong style={{ 
                                  fontSize: 13, 
                                  display: 'block',
                                  marginBottom: 4,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {template.name}
                                </Strong>
                                <Paragraph style={{ 
                                  fontSize: 11, 
                                  marginBottom: 4,
                                  opacity: 0.7,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {template.domain}
                                </Paragraph>
                                <Paragraph style={{ fontSize: 10, marginBottom: 0, opacity: 0.5 }}>
                                  {new Date(template.createdAt).toLocaleDateString()}
                                </Paragraph>
                              </div>
                            </Flex>
                            
                            {/* Action Buttons */}
                            <Flex gap={4} style={{ marginTop: 8 }}>
                              <Button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  loadTemplate(template.id);
                                }}
                                style={{ flex: 1, fontSize: 11, padding: '6px' }}
                              >
                                📂 Load
                              </Button>
                              <Button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  exportTemplate(template.id);
                                }}
                                style={{ flex: 1, fontSize: 11, padding: '6px' }}
                              >
                                📤 Export
                              </Button>
                              <Button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteTemplate(template.id);
                                }}
                                style={{ fontSize: 11, padding: '6px' }}
                              >
                                🗑️
                              </Button>
                            </Flex>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderWelcomeTab = () => (
    <Flex flexDirection="column" gap={20}>
      <Flex flexDirection="row" gap={20}>
        {/* Left Column: App Overview */}
        <div style={{ flex: 1, padding: 20, background: Colors.Background.Surface.Default, borderRadius: 8 }}>
          <Heading level={3} style={{ marginBottom: 12 }}>🎯 Application Overview</Heading>
          <Paragraph style={{ marginBottom: 12, fontSize: 14, lineHeight: 1.5 }}>
            <Strong style={{ color: Colors.Theme.Primary['70'] }}>Business Observability Generator</Strong> creates realistic customer journey scenarios 
            for performance testing and business intelligence demonstrations.
          </Paragraph>
          
          <div style={{ background: 'rgba(108, 44, 156, 0.2)', padding: 16, borderRadius: 8, border: '1px solid rgba(108, 44, 156, 0.6)' }}>
            <Heading level={5} style={{ marginBottom: 10, color: Colors.Theme.Primary['70'] }}>🔧 Core Functionality</Heading>
            <ul style={{ fontSize: 13, lineHeight: 1.7, color: Colors.Text.Neutral.Default, margin: 0, paddingLeft: 20 }}>
              <li><Strong>AI-Generated Journeys:</Strong> Realistic customer paths using AI-generated prompts</li>
              <li><Strong>Business Intelligence:</Strong> Revenue metrics, KPIs, and competitive insights</li>
              <li><Strong>Performance Testing:</Strong> LoadRunner integration with load profiles</li>
              <li><Strong>Real-time Simulation:</Strong> Customer journeys with Dynatrace correlation</li>
            </ul>
          </div>
        </div>

        {/* Right Column: Business Use Cases */}
        <div style={{ flex: 1, padding: 20, background: Colors.Background.Surface.Default, borderRadius: 8 }}>
          <Heading level={3} style={{ marginBottom: 12 }}>💼 Business Use Cases</Heading>
          
          <Flex flexDirection="column" gap={12}>
            <div style={{ background: 'rgba(115, 190, 40, 0.2)', padding: 14, borderRadius: 8, border: '1px solid rgba(115, 190, 40, 0.6)' }}>
              <Heading level={5} style={{ marginBottom: 6 }}>🛍️ E-Commerce Scenarios</Heading>
              <Paragraph style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 0 }}>
                Customer shopping experiences, cart abandonment, payment processing, and seasonal traffic.
              </Paragraph>
            </div>

            <div style={{ background: 'rgba(0, 161, 201, 0.2)', padding: 14, borderRadius: 8, border: '1px solid rgba(0, 161, 201, 0.6)' }}>
              <Heading level={5} style={{ marginBottom: 6 }}>🏢 Enterprise Applications</Heading>
              <Paragraph style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 0 }}>
                B2B workflows, employee onboarding, CRM interactions, and resource management.
              </Paragraph>
            </div>

            <div style={{ background: 'rgba(255, 210, 63, 0.2)', padding: 14, borderRadius: 8, border: '1px solid rgba(255, 210, 63, 0.6)' }}>
              <Heading level={5} style={{ marginBottom: 6 }}>📱 Digital Services</Heading>
              <Paragraph style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 0 }}>
                SaaS platforms, mobile app backends, API performance, and multi-tenant architectures.
              </Paragraph>
            </div>
          </Flex>
        </div>
      </Flex>

      {/* Getting Started Section */}
      <div style={{ padding: 20, background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.1), rgba(108, 44, 156, 0.1))', borderRadius: 8, border: `1px solid ${Colors.Theme.Primary['70']}` }}>
        <Heading level={3} style={{ marginBottom: 20 }}>🚀 Getting Started</Heading>
        <Flex gap={24} justifyContent="space-between">
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
            <Heading level={5} style={{ marginBottom: 6, color: Colors.Theme.Primary['70'] }}>1. Generate AI Prompts</Heading>
            <Paragraph style={{ fontSize: 13, lineHeight: 1.5 }}>Start with company details to create intelligent AI prompts</Paragraph>
          </div>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
            <Heading level={5} style={{ marginBottom: 6, color: Colors.Theme.Primary['70'] }}>2. Build Customer Journey</Heading>
            <Paragraph style={{ fontSize: 13, lineHeight: 1.5 }}>Use AI-generated prompts to create realistic business workflows</Paragraph>
          </div>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
            <Heading level={5} style={{ marginBottom: 6, color: Colors.Theme.Primary['70'] }}>3. Test & Simulate</Heading>
            <Paragraph style={{ fontSize: 13, lineHeight: 1.5 }}>Execute load tests and customer simulations with business intelligence</Paragraph>
          </div>
        </Flex>
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <Button color="primary" variant="emphasized" onClick={() => setActiveTab('step1')} style={{ padding: '12px 28px', fontSize: 15, fontWeight: 600 }}>
            Start Building Your Journey →
          </Button>
        </div>
      </div>
    </Flex>
  );

  const renderStep1Tab = () => (
    <Flex flexDirection="column" gap={20}>
      <Flex gap={24}>
        {/* Left Column: Form */}
        <div style={{ flex: 3, padding: 20, background: Colors.Background.Surface.Default, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
          <Flex alignItems="center" gap={12} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 28 }}>👤</div>
            <Heading level={3} style={{ marginBottom: 0 }}>Step 1 - Customer Details</Heading>
          </Flex>
          
          <Flex flexDirection="column" gap={16}>
            <div>
              <Heading level={5} style={{ marginBottom: 8 }}>🏢 Company Name</Heading>
              <TextInput 
                value={companyName}
                onChange={(value) => setCompanyName(value)}
                placeholder="e.g., ShopMart, TechCorp, HealthPlus"
                style={{ width: '100%' }}
              />
              <Paragraph style={{ fontSize: 12, marginTop: 4, opacity: 0.7, lineHeight: 1.4 }}>
                Company name for your business scenario
              </Paragraph>
            </div>

            <div>
              <Heading level={5} style={{ marginBottom: 8 }}>🌐 Website Domain</Heading>
              <TextInput 
                value={domain}
                onChange={(value) => setDomain(value)}
                placeholder="e.g., shopmart.com, techcorp.io"
                style={{ width: '100%' }}
              />
              <Paragraph style={{ fontSize: 12, marginTop: 4, opacity: 0.7, lineHeight: 1.4 }}>
                Domain for the customer journey simulation
              </Paragraph>
            </div>

            <div>
              <Heading level={5} style={{ marginBottom: 8 }}>🎯 Journey Requirements</Heading>
              <textarea 
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder="e.g., Order journey from website to delivery, Banking loan application process"
                style={{ 
                  width: '100%', 
                  minHeight: 80,
                  padding: 12,
                  background: Colors.Background.Base.Default,
                  border: `1px solid ${Colors.Border.Neutral.Default}`,
                  borderRadius: 4,
                  color: Colors.Text.Neutral.Default,
                  fontFamily: 'inherit',
                  fontSize: 13,
                  lineHeight: 1.5,
                  resize: 'vertical'
                }}
              />
            </div>

            <Flex justifyContent="flex-end" gap={12} style={{ marginTop: 8 }}>
              <Button onClick={() => setActiveTab('welcome')} style={{ padding: '8px 16px' }}>
                ← Back
              </Button>
              <Button 
                color="primary"
                variant="emphasized"
                onClick={() => setActiveTab('step2')}
                disabled={!companyName || !domain}
                style={{ padding: '8px 20px' }}
              >
                Next: Generate Prompts →
              </Button>
            </Flex>
          </Flex>
        </div>

        {/* Right Column: Instructions & Stats */}
        <div style={{ flex: 2 }}>
          <div style={{ 
            padding: 20, 
            background: `linear-gradient(135deg, ${Colors.Background.Surface.Default}, rgba(0, 161, 201, 0.05))`,
            borderRadius: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            marginBottom: 16
          }}>
            <Heading level={4} style={{ marginBottom: 16 }}>📊 Template Statistics</Heading>
            <Flex gap={12}>
              <div style={{ 
                flex: 1,
                padding: 16,
                background: 'linear-gradient(135deg, rgba(108, 44, 156, 0.2), rgba(108, 44, 156, 0.1))',
                borderRadius: 10,
                textAlign: 'center',
                border: '2px solid rgba(108, 44, 156, 0.4)'
              }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: Colors.Theme.Primary['70'] }}>{savedTemplates.length}</div>
                <Paragraph style={{ fontSize: 11, marginBottom: 0, marginTop: 4 }}>Saved Templates</Paragraph>
              </div>
              <div style={{ 
                flex: 1,
                padding: 16,
                background: 'linear-gradient(135deg, rgba(115, 190, 40, 0.2), rgba(115, 190, 40, 0.1))',
                borderRadius: 10,
                textAlign: 'center',
                border: '2px solid rgba(115, 190, 40, 0.4)'
              }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: Colors.Theme.Success['70'] }}>{companyName && domain ? '✓' : '○'}</div>
                <Paragraph style={{ fontSize: 11, marginBottom: 0, marginTop: 4 }}>Form Complete</Paragraph>
              </div>
            </Flex>
          </div>

          <div style={{ padding: 20, background: Colors.Background.Surface.Default, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <Heading level={4} style={{ marginBottom: 12 }}>📋 What We'll Create</Heading>
            <Flex flexDirection="column" gap={12}>
              <div style={{ padding: 14, background: 'rgba(0, 161, 201, 0.15)', borderRadius: 8, border: '2px solid rgba(0, 161, 201, 0.5)' }}>
                <Flex alignItems="center" gap={8} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 20 }}>🤖</div>
                  <Heading level={5} style={{ marginBottom: 0 }}>AI-Generated Journey</Heading>
                </Flex>
                <ul style={{ fontSize: 13, lineHeight: 1.6, margin: 0, paddingLeft: 20 }}>
                  <li>Realistic customer interaction patterns</li>
                  <li>Business intelligence & revenue metrics</li>
                  <li>Industry-specific journey steps</li>
                  <li>Performance testing configurations</li>
                </ul>
              </div>

              <div style={{ padding: 14, background: 'rgba(255, 210, 63, 0.15)', borderRadius: 8, border: '2px solid rgba(255, 210, 63, 0.5)' }}>
                <Flex alignItems="center" gap={8} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 20 }}>🚀</div>
                  <Heading level={5} style={{ marginBottom: 0 }}>Next Steps</Heading>
                </Flex>
                <Paragraph style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 0 }}>
                  Generate tailored AI prompts to create realistic business scenarios.
                </Paragraph>
              </div>
            </Flex>
          </div>
        </div>
      </Flex>
    </Flex>
  );

  const step2Phases = [
    { key: 'prompts' as const, label: 'Copy Prompts', icon: '📝', number: 1 },
    { key: 'response' as const, label: 'Paste Response', icon: '📥', number: 2 },
    { key: 'generate' as const, label: 'Generate Services', icon: '🚀', number: 3 },
  ];

  const step2PhaseIndex = step2Phases.findIndex(p => p.key === step2Phase);

  const renderStep2Tab = () => (
    <Flex flexDirection="column" gap={16}>
      <div style={{ padding: 20, background: Colors.Background.Surface.Default, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        {/* Header */}
        <Flex alignItems="center" gap={12} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 28 }}>🤖</div>
          <div style={{ flex: 1 }}>
            <Heading level={3} style={{ marginBottom: 0 }}>Step 2 — AI Prompt Generation</Heading>
            <Paragraph style={{ fontSize: 12, marginBottom: 0, marginTop: 2, opacity: 0.7 }}>
              {companyName} • {domain}
            </Paragraph>
          </div>
        </Flex>

        {/* ── Sub-step progress bar ─── */}
        <Flex gap={0} style={{ marginBottom: 24 }}>
          {step2Phases.map((phase, idx) => {
            const isActive = phase.key === step2Phase;
            const isCompleted = idx < step2PhaseIndex;
            const isClickable = idx <= step2PhaseIndex || (idx === step2PhaseIndex + 1);
            return (
              <div
                key={phase.key}
                onClick={() => isClickable && setStep2Phase(phase.key)}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  cursor: isClickable ? 'pointer' : 'default',
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(108,44,156,0.2), rgba(0,212,255,0.15))'
                    : isCompleted
                    ? 'rgba(115,190,40,0.1)'
                    : 'rgba(0,0,0,0.02)',
                  borderBottom: isActive ? '3px solid #6c2c9c' : isCompleted ? '3px solid rgba(115,190,40,0.5)' : '3px solid transparent',
                  borderRadius: idx === 0 ? '10px 0 0 0' : idx === step2Phases.length - 1 ? '0 10px 0 0' : 0,
                  transition: 'all 0.2s ease',
                  opacity: (!isActive && !isCompleted && !isClickable) ? 0.4 : 1,
                }}
              >
                <Flex alignItems="center" gap={8}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700,
                    background: isCompleted ? Colors.Theme.Success['70'] : isActive ? '#6c2c9c' : 'rgba(0,0,0,0.1)',
                    color: (isCompleted || isActive) ? 'white' : Colors.Text.Neutral.Default,
                  }}>
                    {isCompleted ? '✓' : phase.number}
                  </div>
                  <div>
                    <Strong style={{ fontSize: 13 }}>{phase.label}</Strong>
                  </div>
                </Flex>
              </div>
            );
          })}
        </Flex>

        {/* ════════ SUB-STEP 1: Copy Prompts ════════ */}
        {step2Phase === 'prompts' && (
          <div>
            <Paragraph style={{ fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
              Copy each prompt below into an <Strong>external AI assistant</Strong> (e.g. ChatGPT, Gemini, or Microsoft Copilot — <em>not</em> Dynatrace Copilot). Run Prompt 1 first, then Prompt 2 in the <Strong>same conversation</Strong>.
            </Paragraph>

            {/* Prompt 1 */}
            <div style={{
              marginBottom: 16, padding: 16,
              background: 'linear-gradient(135deg, rgba(0,161,201,0.08), rgba(0,161,201,0.03))',
              borderRadius: 10, border: '2px solid rgba(0,161,201,0.4)',
            }}>
              <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: 8 }}>
                <Flex alignItems="center" gap={8}>
                  <div style={{ fontSize: 18 }}>💼</div>
                  <Strong style={{ fontSize: 14 }}>Prompt 1 — C-suite Analysis</Strong>
                </Flex>
                <Button onClick={() => copyToClipboard(prompt1, 'Prompt 1')} variant="emphasized">📋 Copy</Button>
              </Flex>
              <Paragraph style={{ fontSize: 12, marginBottom: 8, opacity: 0.8, padding: '6px 10px', background: 'rgba(0,161,201,0.12)', borderRadius: 6 }}>
                {PROMPT_DESCRIPTIONS.csuite.description}
              </Paragraph>
              <textarea
                readOnly value={prompt1}
                style={{
                  width: '100%', height: 130, padding: 12,
                  background: Colors.Background.Base.Default,
                  border: '1px solid rgba(0,161,201,0.4)', borderRadius: 8,
                  color: Colors.Text.Neutral.Default, fontFamily: 'monospace', fontSize: 12,
                  resize: 'vertical', lineHeight: 1.5,
                }}
              />
            </div>

            {/* Prompt 2 */}
            <div style={{
              marginBottom: 16, padding: 16,
              background: 'linear-gradient(135deg, rgba(108,44,156,0.08), rgba(108,44,156,0.03))',
              borderRadius: 10, border: '2px solid rgba(108,44,156,0.4)',
            }}>
              <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: 8 }}>
                <Flex alignItems="center" gap={8}>
                  <div style={{ fontSize: 18 }}>🗺️</div>
                  <Strong style={{ fontSize: 14 }}>Prompt 2 — Customer Journey</Strong>
                </Flex>
                <Button onClick={() => copyToClipboard(prompt2, 'Prompt 2')} variant="emphasized">📋 Copy</Button>
              </Flex>
              <Paragraph style={{ fontSize: 12, marginBottom: 8, opacity: 0.8, padding: '6px 10px', background: 'rgba(108,44,156,0.12)', borderRadius: 6 }}>
                {PROMPT_DESCRIPTIONS.journey.description}
              </Paragraph>
              <textarea
                readOnly value={prompt2}
                style={{
                  width: '100%', height: 130, padding: 12,
                  background: Colors.Background.Base.Default,
                  border: '1px solid rgba(108,44,156,0.4)', borderRadius: 8,
                  color: Colors.Text.Neutral.Default, fontFamily: 'monospace', fontSize: 12,
                  resize: 'vertical', lineHeight: 1.5,
                }}
              />
            </div>

            <Flex justifyContent="space-between" style={{ marginTop: 8 }}>
              <Button onClick={() => setActiveTab('step1')}>← Back to Details</Button>
              <Button variant="emphasized" onClick={() => setStep2Phase('response')} style={{ padding: '10px 24px', fontWeight: 600 }}>
                Continue to Paste Response →
              </Button>
            </Flex>
          </div>
        )}

        {/* ════════ SUB-STEP 2: Paste Response ════════ */}
        {step2Phase === 'response' && (
          <div>
            <Paragraph style={{ fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
              Paste the <Strong>JSON response</Strong> from your AI assistant below, then click <Strong>Validate</Strong> to check the format.
            </Paragraph>

            <div style={{
              padding: 16, borderRadius: 10,
              border: `2px solid ${copilotResponse.trim() ? Colors.Theme.Success['70'] : Colors.Border.Neutral.Default}`,
              background: Colors.Background.Surface.Default,
              boxShadow: copilotResponse.trim() ? '0 2px 8px rgba(115,190,40,0.15)' : 'none',
            }}>
              <Flex alignItems="center" gap={8} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 16 }}>{copilotResponse.trim() ? '✅' : '📝'}</div>
                <Strong style={{ fontSize: 13 }}>
                  {copilotResponse.trim() ? 'Response Received' : 'Awaiting Response'}
                </Strong>
                {copilotResponse.trim() && (
                  <Button onClick={() => setCopilotResponse('')} style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px' }}>🗑️ Clear</Button>
                )}
              </Flex>
              <textarea
                value={copilotResponse}
                onChange={(e) => setCopilotResponse(e.target.value)}
                placeholder="Paste the JSON response from the AI assistant here..."
                style={{
                  width: '100%', height: 260, padding: 16,
                  background: Colors.Background.Base.Default,
                  border: `1px solid ${Colors.Border.Neutral.Default}`, borderRadius: 8,
                  color: Colors.Text.Neutral.Default, fontFamily: 'monospace', fontSize: 12,
                  resize: 'vertical', lineHeight: 1.5,
                }}
              />

              {generationStatus && (
                <div style={{
                  marginTop: 10, padding: 10, borderRadius: 6, fontSize: 13, fontFamily: 'monospace',
                  background: generationStatus.includes('✅') ? 'rgba(115,190,40,0.1)' : generationStatus.includes('❌') ? 'rgba(220,50,47,0.1)' : 'rgba(0,161,201,0.1)',
                  border: `1px solid ${generationStatus.includes('✅') ? Colors.Theme.Success['70'] : generationStatus.includes('❌') ? '#dc322f' : Colors.Theme.Primary['70']}`,
                }}>
                  {generationStatus}
                </div>
              )}
            </div>

            <Flex justifyContent="space-between" style={{ marginTop: 16 }}>
              <Button onClick={() => setStep2Phase('prompts')}>← Back to Prompts</Button>
              <Flex gap={8}>
                <Button variant="emphasized" onClick={processResponse} disabled={!copilotResponse.trim()} style={{ padding: '10px 20px', fontWeight: 600 }}>
                  ⚡ Validate Response
                </Button>
                <Button onClick={() => setStep2Phase('generate')} disabled={!copilotResponse.trim()} style={{ padding: '10px 24px', fontWeight: 600 }}>
                  Continue to Generate →
                </Button>
              </Flex>
            </Flex>
          </div>
        )}

        {/* ════════ SUB-STEP 3: Generate Services ════════ */}
        {step2Phase === 'generate' && (
          <div>
            <Paragraph style={{ fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
              Everything is ready. Click <Strong>Generate Services</Strong> to create live services on your configured host.
            </Paragraph>

            {/* Summary card */}
            <div style={{
              padding: 16, marginBottom: 20, borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(115,190,40,0.1), rgba(0,212,255,0.08))',
              border: `1px solid ${Colors.Theme.Success['70']}`,
            }}>
              <Flex gap={20}>
                <div>
                  <Strong style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase' as const }}>Company</Strong>
                  <Paragraph style={{ fontSize: 14, marginBottom: 0, marginTop: 2 }}>{companyName}</Paragraph>
                </div>
                <div>
                  <Strong style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase' as const }}>Domain</Strong>
                  <Paragraph style={{ fontSize: 14, marginBottom: 0, marginTop: 2 }}>{domain}</Paragraph>
                </div>
                <div>
                  <Strong style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase' as const }}>Target</Strong>
                  <Paragraph style={{ fontSize: 14, marginBottom: 0, marginTop: 2 }}>{apiSettings.host}:{apiSettings.port}</Paragraph>
                </div>
                <div>
                  <Strong style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase' as const }}>Response</Strong>
                  <Paragraph style={{ fontSize: 14, marginBottom: 0, marginTop: 2, color: Colors.Theme.Success['70'] }}>✓ Pasted</Paragraph>
                </div>
              </Flex>
            </div>

            <Flex justifyContent="center" style={{ marginBottom: 16 }}>
              <Button
                onClick={generateServices}
                disabled={!copilotResponse.trim() || isGeneratingServices}
                style={{
                  padding: '14px 40px', fontWeight: 700, fontSize: 15,
                  background: isGeneratingServices ? 'rgba(0,161,201,0.2)' : 'linear-gradient(135deg, rgba(115,190,40,0.9), rgba(0,161,201,0.9))',
                  color: 'white', borderRadius: 10, border: 'none',
                }}
              >
                {isGeneratingServices ? '🔄 Generating...' : '🚀 Generate Services'}
              </Button>
            </Flex>

            {generationStatus && (
              <div style={{
                padding: 12, borderRadius: 8, fontSize: 13, fontFamily: 'monospace', textAlign: 'center' as const,
                background: generationStatus.includes('✅') ? 'rgba(115,190,40,0.1)' : generationStatus.includes('❌') ? 'rgba(220,50,47,0.1)' : 'rgba(0,161,201,0.1)',
                border: `1px solid ${generationStatus.includes('✅') ? Colors.Theme.Success['70'] : generationStatus.includes('❌') ? '#dc322f' : Colors.Theme.Primary['70']}`,
              }}>
                {generationStatus}
              </div>
            )}

            <Flex justifyContent="space-between" style={{ marginTop: 20 }}>
              <Button onClick={() => setStep2Phase('response')}>← Back to Response</Button>
              <Button onClick={openSettingsModal}>⚙️ API Settings</Button>
            </Flex>
          </div>
        )}
      </div>
    </Flex>
  );

  return (
    <Page>
      <Page.Header>
        <TitleBar>
          <TitleBar.Title>
            <span style={{ background: 'linear-gradient(135deg, #6c2c9c, #00d4ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 700 }}>
              🤖 AI Business Observability Generator
            </span>
          </TitleBar.Title>
          <TitleBar.Subtitle>AI-powered customer journey simulation &amp; service creation platform</TitleBar.Subtitle>
          <TitleBar.Action>
            <Flex gap={12} alignItems="center">
              {/* Get Started Button — prominent */}
              <button
                onClick={() => setShowGetStartedModal(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 22px', borderRadius: 10,
                  background: completedCount === totalSteps
                    ? 'linear-gradient(135deg, rgba(0,180,0,0.2), rgba(115,190,40,0.12))'
                    : 'linear-gradient(135deg, #6c2c9c, #00a1c9)',
                  border: completedCount === totalSteps
                    ? '2px solid rgba(0,180,0,0.5)'
                    : '2px solid rgba(108,44,156,0.7)',
                  color: completedCount === totalSteps ? '#2e7d32' : 'white',
                  fontWeight: 700, fontSize: 14,
                  cursor: 'pointer', transition: 'all 0.2s ease',
                  boxShadow: completedCount < totalSteps ? '0 2px 12px rgba(108,44,156,0.4)' : 'none',
                }}
                onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(108,44,156,0.4)'; }}
                onMouseOut={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = completedCount < totalSteps ? '0 2px 12px rgba(108,44,156,0.4)' : 'none'; }}
              >
                <span style={{ fontSize: 18 }}>{completedCount === totalSteps ? '✅' : '🚀'}</span>
                Get Started
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: completedCount === totalSteps ? 'rgba(0,180,0,0.2)' : 'rgba(255,255,255,0.25)', fontWeight: 700 }}>{completedCount}/{totalSteps}</span>
              </button>

              {/* Services Button with ? tooltip */}
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={openServicesModal}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 22px', borderRadius: 10,
                    background: 'linear-gradient(135deg, rgba(220,50,47,0.15), rgba(220,50,47,0.08))',
                    border: '2px solid rgba(220,50,47,0.4)',
                    color: '#dc322f', fontWeight: 700, fontSize: 14,
                    cursor: 'pointer', transition: 'all 0.2s ease',
                  }}
                  onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(220,50,47,0.3)'; }}
                  onMouseOut={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <span style={{ fontSize: 18 }}>🖥️</span> Services
                </button>
                <div
                  style={{ position: 'relative', display: 'inline-block' }}
                  onMouseEnter={() => setShowServicesTooltip(true)}
                  onMouseLeave={() => setShowServicesTooltip(false)}
                >
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(220,50,47,0.15)', border: '1.5px solid rgba(220,50,47,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'help', fontSize: 11, fontWeight: 700, color: '#dc322f' }}>?</div>
                  {showServicesTooltip && (
                    <div style={{ position: 'absolute', top: 28, right: 0, width: 260, padding: 14, borderRadius: 10, background: Colors.Background.Surface.Default, border: `1.5px solid ${Colors.Border.Neutral.Default}`, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', zIndex: 10000, fontSize: 12, lineHeight: 1.6 }}>
                      <Strong style={{ fontSize: 13, marginBottom: 6, display: 'block' }}>🖥️ Services Panel</Strong>
                      <div>View and manage all running child services generated from your journey configurations.</div>
                      <div style={{ marginTop: 6 }}><Strong>Running</Strong> — Active services processing traffic</div>
                      <div><Strong>Dormant</Strong> — Stopped services remembered for quick restart (ports are freed)</div>
                      <div style={{ marginTop: 6, opacity: 0.6 }}>Stop per-company or all at once. Clear dormant to forget them entirely.</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Chaos Gremlin Agent Button with ? tooltip */}
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={openChaosModal}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 22px', borderRadius: 10,
                    background: `linear-gradient(135deg, rgba(181,137,0,0.15), rgba(220,50,47,0.08))`,
                    border: '2px solid rgba(181,137,0,0.5)',
                    color: '#b58900', fontWeight: 700, fontSize: 14,
                    cursor: 'pointer', transition: 'all 0.2s ease',
                  }}
                  onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(181,137,0,0.3)'; }}
                  onMouseOut={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <svg width="20" height="20" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
                    <circle cx="32" cy="34" r="22" fill="#6b8e23"/>
                    <ellipse cx="22" cy="28" rx="6" ry="7" fill="white"/>
                    <ellipse cx="42" cy="28" rx="6" ry="7" fill="white"/>
                    <circle cx="23" cy="28" r="3.5" fill="#dc322f"/>
                    <circle cx="43" cy="28" r="3.5" fill="#dc322f"/>
                    <path d="M22 42 Q32 50 42 42" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                    <rect x="24" y="42" width="3" height="4" rx="1" fill="white" transform="rotate(-8 25.5 44)"/>
                    <rect x="30.5" y="43" width="3" height="4.5" rx="1" fill="white"/>
                    <rect x="37" y="42" width="3" height="4" rx="1" fill="white" transform="rotate(8 38.5 44)"/>
                    <path d="M14 16 Q18 24 22 22" stroke="#6b8e23" strokeWidth="3" fill="none" strokeLinecap="round"/>
                    <path d="M50 16 Q46 24 42 22" stroke="#6b8e23" strokeWidth="3" fill="none" strokeLinecap="round"/>
                    <ellipse cx="12" cy="14" rx="4" ry="5" fill="#6b8e23"/>
                    <ellipse cx="52" cy="14" rx="4" ry="5" fill="#6b8e23"/>
                  </svg>
                  Gremlin
                  {activeFaults.length > 0 && (
                    <span style={{ background: '#dc322f', color: 'white', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700, minWidth: 18, textAlign: 'center' as const }}>{activeFaults.length}</span>
                  )}
                </button>
                <div
                  style={{ position: 'relative', display: 'inline-block' }}
                  onMouseEnter={() => setShowChaosTooltip(true)}
                  onMouseLeave={() => setShowChaosTooltip(false)}
                >
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(181,137,0,0.15)', border: '1.5px solid rgba(181,137,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'help', fontSize: 11, fontWeight: 700, color: '#b58900' }}>?</div>
                  {showChaosTooltip && (
                    <div style={{ position: 'absolute', top: 28, right: 0, width: 280, padding: 14, borderRadius: 10, background: Colors.Background.Surface.Default, border: `1.5px solid ${Colors.Border.Neutral.Default}`, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', zIndex: 10000, fontSize: 12, lineHeight: 1.6 }}>
                      <Strong style={{ fontSize: 13, marginBottom: 6, display: 'block' }}>👹 Chaos Gremlin Agent</Strong>
                      <div>Inject faults into running services to test resilience and trigger Dynatrace problem detection.</div>
                      <div style={{ marginTop: 6 }}><Strong>Single Service</Strong> — Target one specific service</div>
                      <div><Strong>Whole Journey</Strong> — Hit all services for a company at once</div>
                      <div><Strong>Smart Chaos</Strong> — Describe what to break in plain English; AI picks the attack</div>
                      <div><Strong>Revert</Strong> — Undo faults instantly or wait for auto-revert</div>
                      <div style={{ marginTop: 6, opacity: 0.6 }}>All chaos events are recorded as Dynatrace deployment events for correlation with problems.</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Settings Button with ? tooltip */}
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={openSettingsModal}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 22px', borderRadius: 10,
                    background: 'linear-gradient(135deg, rgba(108,44,156,0.15), rgba(0,212,255,0.08))',
                    border: '2px solid rgba(108,44,156,0.4)',
                    color: Colors.Theme.Primary['70'], fontWeight: 700, fontSize: 14,
                    cursor: 'pointer', transition: 'all 0.2s ease',
                  }}
                  onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(108,44,156,0.3)'; }}
                  onMouseOut={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <span style={{ fontSize: 18 }}>⚙️</span> Settings
                </button>
                <div
                  style={{ position: 'relative', display: 'inline-block' }}
                  onMouseEnter={() => setShowSettingsTooltip(true)}
                  onMouseLeave={() => setShowSettingsTooltip(false)}
                >
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(108,44,156,0.15)', border: '1.5px solid rgba(108,44,156,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'help', fontSize: 11, fontWeight: 700, color: Colors.Theme.Primary['70'] }}>?</div>
                  {showSettingsTooltip && (
                    <div style={{ position: 'absolute', top: 28, right: 0, width: 260, padding: 14, borderRadius: 10, background: Colors.Background.Surface.Default, border: `1.5px solid ${Colors.Border.Neutral.Default}`, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', zIndex: 10000, fontSize: 12, lineHeight: 1.6 }}>
                      <Strong style={{ fontSize: 13, marginBottom: 6, display: 'block' }}>⚙️ API Settings</Strong>
                      <div>Configure the connection to your BizObs Generator server.</div>
                      <div style={{ marginTop: 6 }}><Strong>Host</Strong> — IP address or hostname of your server</div>
                      <div><Strong>Port</Strong> — Server port (default 8080)</div>
                      <div><Strong>Protocol</Strong> — HTTP for internal, HTTPS for production</div>
                      <div style={{ marginTop: 6, opacity: 0.6 }}>Use "Test" to verify connectivity before saving. Check the "Get Started" tab for a full setup guide.</div>
                    </div>
                  )}
                </div>
              </div>
            </Flex>
          </TitleBar.Action>
        </TitleBar>
      </Page.Header>

      <Page.Main>
        <Flex style={{ height: '100%' }}>
          {/* Sidebar */}
          {renderSidebar()}

          {/* Main Content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          {/* Progress Indicator - compact, fixed at top */}
          <div style={{ 
            padding: '12px 24px',
            flexShrink: 0,
            background: 'linear-gradient(135deg, rgba(108, 44, 156, 0.08), rgba(0, 212, 255, 0.08))',
            borderBottom: `1px solid ${Colors.Border.Neutral.Default}`
          }}>
            <Flex justifyContent="center" alignItems="center" gap={0}>
              {[
                { id: 'welcome', label: 'Welcome', icon: '🏠', step: 0 },
                { id: 'step1', label: 'Customer Details', icon: '👤', step: 1 },
                { id: 'step2', label: 'Generate Prompts', icon: '🤖', step: 2 }
              ].map((item, index) => (
                <React.Fragment key={item.id}>
                  <Flex 
                    alignItems="center" 
                    gap={8}
                    style={{ 
                      cursor: (item.id === 'step2' && (!companyName || !domain)) ? 'not-allowed' : 'pointer',
                      opacity: (item.id === 'step2' && (!companyName || !domain)) ? 0.5 : 1,
                      padding: '8px 20px',
                      borderRadius: 8,
                      background: activeTab === item.id 
                        ? `linear-gradient(135deg, ${Colors.Theme.Primary['70']}, rgba(0, 212, 255, 0.8))` 
                        : 'transparent',
                      transition: 'all 0.3s ease',
                    }}
                    onClick={() => {
                      if (item.id !== 'step2' || (companyName && domain)) {
                        setActiveTab(item.id);
                      }
                    }}
                  >
                    <div style={{ fontSize: 18 }}>{item.icon}</div>
                    <Strong style={{ 
                      fontSize: 13,
                      color: activeTab === item.id ? 'white' : Colors.Text.Neutral.Default
                    }}>
                      {item.label}
                    </Strong>
                  </Flex>
                  {index < 2 && (
                    <div style={{ 
                      width: 40, 
                      height: 2, 
                      background: index < (activeTab === 'welcome' ? 0 : activeTab === 'step1' ? 1 : 2) 
                        ? Colors.Theme.Primary['70'] 
                        : Colors.Border.Neutral.Default,
                      margin: '0 4px',
                      transition: 'all 0.3s ease'
                    }} />
                  )}
                </React.Fragment>
              ))}
            </Flex>
          </div>

          {/* Tab Content - fills remaining space */}
          <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {activeTab === 'welcome' && renderWelcomeTab()}
          {activeTab === 'step1' && renderStep1Tab()}
          {activeTab === 'step2' && renderStep2Tab()}
          </div>
          </div>
        </Flex>
      </Page.Main>

      {/* ── Settings Modal ─────────────────────────────── */}
      {showSettingsModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} onClick={() => setShowSettingsModal(false)} />
          <div style={{ position: 'relative', width: 860, maxHeight: '85vh', overflow: 'auto', background: Colors.Background.Surface.Default, borderRadius: 16, border: `2px solid ${Colors.Border.Neutral.Default}`, boxShadow: '0 24px 48px rgba(0,0,0,0.3)' }}>
            {/* Header */}
            <div style={{ padding: '16px 24px', background: `linear-gradient(135deg, ${Colors.Theme.Primary['70']}, rgba(108,44,156,0.9))`, borderRadius: '14px 14px 0 0' }}>
              <Flex alignItems="center" justifyContent="space-between">
                <Flex alignItems="center" gap={12}>
                  <span style={{ fontSize: 24 }}>⚙️</span>
                  <div>
                    <Strong style={{ color: 'white', fontSize: 16 }}>API Settings</Strong>
                    <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>Configure BizObs Generator connection</div>
                  </div>
                </Flex>
                <Flex alignItems="center" gap={8}>
                  {/* Tab switcher */}
                  <button onClick={() => setSettingsTab('config')} style={{ padding: '4px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: settingsTab === 'config' ? 'rgba(255,255,255,0.25)' : 'transparent', color: 'white', transition: 'all 0.2s' }}>⚙️ Config</button>
                  <button onClick={() => setSettingsTab('guide')} style={{ padding: '4px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: settingsTab === 'guide' ? 'rgba(255,255,255,0.25)' : 'transparent', color: 'white', transition: 'all 0.2s' }}>📖 Get Started</button>
                  <button onClick={() => { setSettingsTab('edgeconnect'); loadEdgeConnects(); }} style={{ padding: '4px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: settingsTab === 'edgeconnect' ? 'rgba(255,255,255,0.25)' : 'transparent', color: 'white', transition: 'all 0.2s' }}>🔌 EdgeConnect</button>
                  <button onClick={() => setShowSettingsModal(false)} style={{ background: 'none', border: 'none', color: 'white', fontSize: 20, cursor: 'pointer', padding: 4, marginLeft: 8 }}>✕</button>
                </Flex>
              </Flex>
            </div>

            {settingsTab === 'config' ? (
            <div style={{ padding: 24 }}>
              {/* Status */}
              {settingsStatus && (
                <div style={{ padding: 10, marginBottom: 16, borderRadius: 8, fontSize: 13, fontFamily: 'monospace',
                  background: settingsStatus.includes('✅') ? 'rgba(115,190,40,0.12)' : settingsStatus.includes('❌') ? 'rgba(220,50,47,0.12)' : 'rgba(0,161,201,0.12)',
                  border: `1px solid ${settingsStatus.includes('✅') ? Colors.Theme.Success['70'] : settingsStatus.includes('❌') ? '#dc322f' : Colors.Theme.Primary['70']}` }}>
                  {settingsStatus}
                </div>
              )}

              {/* Protocol */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Protocol</label>
                <Flex gap={8}>
                  <Button variant={settingsForm.apiProtocol === 'http' ? 'emphasized' : 'default'} onClick={() => setSettingsForm(p => ({ ...p, apiProtocol: 'http' }))} style={{ flex: 1 }}>HTTP</Button>
                  <Button variant={settingsForm.apiProtocol === 'https' ? 'emphasized' : 'default'} onClick={() => setSettingsForm(p => ({ ...p, apiProtocol: 'https' }))} style={{ flex: 1 }}>HTTPS</Button>
                </Flex>
              </div>

              {/* Host */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Host / IP Address</label>
                <TextInput value={settingsForm.apiHost} onChange={(v: string) => setSettingsForm(p => ({ ...p, apiHost: v }))} placeholder="localhost or IP address" />
              </div>

              {/* Port */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Port</label>
                <TextInput value={settingsForm.apiPort} onChange={(v: string) => setSettingsForm(p => ({ ...p, apiPort: v }))} placeholder="8080" />
              </div>

              {/* URL Preview */}
              <div style={{ padding: 12, background: 'rgba(0,161,201,0.08)', border: `1px solid ${Colors.Theme.Primary['70']}`, borderRadius: 8, marginBottom: 16 }}>
                <Strong style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>Full API URL:</Strong>
                <code style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {settingsForm.apiProtocol}://{settingsForm.apiHost}:{settingsForm.apiPort}/api/journey-simulation/simulate-journey
                </code>
              </div>

              {/* Actions */}
              <Flex gap={8}>
                <Button variant="emphasized" onClick={saveSettingsFromModal} disabled={isSavingSettings} style={{ flex: 2, fontWeight: 600 }}>
                  {isSavingSettings ? '💾 Saving...' : '💾 Save'}
                </Button>
                <Button onClick={testConnectionFromModal} disabled={isTestingConnection} style={{ flex: 1 }}>
                  {isTestingConnection ? '🔄...' : '🔌 Test'}
                </Button>
                <Button onClick={() => { setSettingsForm(DEFAULT_SETTINGS); setSettingsStatus('🔄 Reset to defaults'); }} style={{ flex: 1 }}>🔄 Reset</Button>
              </Flex>
            </div>
            ) : settingsTab === 'guide' ? (
            /* ── Get Started Guide Tab ─── */
            <div style={{ padding: 24 }}>
              <div style={{ marginBottom: 20 }}>
                <Flex alignItems="center" gap={8} style={{ marginBottom: 12 }}>
                  <span style={{ fontSize: 22 }}>🚀</span>
                  <Heading level={5}>Get Started Guide</Heading>
                </Flex>
                <Paragraph style={{ fontSize: 13, opacity: 0.8, marginBottom: 16 }}>
                  Follow these steps to configure and start generating AI-driven business observability services.
                </Paragraph>
              </div>

              {/* Step 1: Configure Connection */}
              <div style={{ marginBottom: 16, padding: 16, borderRadius: 10, border: `1px solid ${Colors.Border.Neutral.Default}`, background: 'rgba(108,44,156,0.04)' }}>
                <Flex alignItems="flex-start" gap={12}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: `linear-gradient(135deg, ${Colors.Theme.Primary['70']}, #00d4ff)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>1</div>
                  <div>
                    <Strong style={{ fontSize: 14 }}>Configure API Connection</Strong>
                    <Paragraph style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      Click the <Strong>⚙️ Settings</Strong> button in the title bar (or switch to the "Config" tab above). Enter your BizObs Generator server's <Strong>host IP</Strong> and <Strong>port</Strong> (default: 8080). Use <Strong>HTTP</Strong> for local/internal servers, <Strong>HTTPS</Strong> for production. Click <Strong>🔌 Test</Strong> to verify connectivity, then <Strong>💾 Save</Strong>.
                    </Paragraph>
                  </div>
                </Flex>
              </div>

              {/* Step 2: Choose or Create Template */}
              <div style={{ marginBottom: 16, padding: 16, borderRadius: 10, border: `1px solid ${Colors.Border.Neutral.Default}`, background: 'rgba(0,212,255,0.04)' }}>
                <Flex alignItems="flex-start" gap={12}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: `linear-gradient(135deg, #00d4ff, ${Colors.Theme.Success['70']})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>2</div>
                  <div>
                    <Strong style={{ fontSize: 14 }}>Enter Customer Details</Strong>
                    <Paragraph style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      On the <Strong>Welcome</Strong> tab, click a pre-built template from the sidebar (e.g., "TechCorp", "RetailMax") or start fresh. Enter a <Strong>Company Name</Strong>, <Strong>Domain</Strong>, and optionally specific <Strong>Requirements</Strong>. Click <Strong>Next</Strong> to generate AI prompts.
                    </Paragraph>
                  </div>
                </Flex>
              </div>

              {/* Step 3: Generate Prompts */}
              <div style={{ marginBottom: 16, padding: 16, borderRadius: 10, border: `1px solid ${Colors.Border.Neutral.Default}`, background: 'rgba(115,190,40,0.04)' }}>
                <Flex alignItems="flex-start" gap={12}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: `linear-gradient(135deg, ${Colors.Theme.Success['70']}, #73be28)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>3</div>
                  <div>
                    <Strong style={{ fontSize: 14 }}>Use AI Prompts</Strong>
                    <Paragraph style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      On the <Strong>Generate Prompts</Strong> tab, you'll see two prompts: <Strong>C-Suite Prompt</Strong> (defines the business) and <Strong>Journey Prompt</Strong> (defines the customer journey). Copy each prompt, paste into an external AI assistant (ChatGPT, Gemini, Microsoft Copilot), and paste the JSON response back.
                    </Paragraph>
                  </div>
                </Flex>
              </div>

              {/* Step 4: Generate & Monitor Services */}
              <div style={{ marginBottom: 16, padding: 16, borderRadius: 10, border: `1px solid ${Colors.Border.Neutral.Default}`, background: 'rgba(220,50,47,0.04)' }}>
                <Flex alignItems="flex-start" gap={12}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #dc322f, #b58900)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>4</div>
                  <div>
                    <Strong style={{ fontSize: 14 }}>Generate & Monitor Services</Strong>
                    <Paragraph style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      Click <Strong>Generate Services</Strong> to spawn live Node.js services on the BizObs server. Use the <Strong>🖥️ Services</Strong> button in the title bar to monitor running services, stop them by company, or clear dormant ones. Dormant services remember their metadata so they restart faster.
                    </Paragraph>
                  </div>
                </Flex>
              </div>

              {/* Network & Firewall Configuration */}
              <div style={{ marginBottom: 16, padding: 16, borderRadius: 10, border: `1px solid rgba(220,160,0,0.4)`, background: 'rgba(220,160,0,0.04)' }}>
                <Flex alignItems="flex-start" gap={12}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #b58900, #dc322f)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>🔒</div>
                  <div style={{ flex: 1 }}>
                    <Strong style={{ fontSize: 14 }}>Network & Firewall Configuration</Strong>
                    <Paragraph style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      This app runs as a <Strong>Dynatrace AppEngine</Strong> serverless function. When it calls your BizObs Generator server, the request originates from <Strong>Dynatrace’s cloud infrastructure</Strong>, not your browser.
                    </Paragraph>

                    {/* EdgeConnect — Recommended Approach */}
                    <div style={{ marginTop: 10, padding: 14, borderRadius: 10, background: 'rgba(0,180,0,0.06)', border: '1.5px solid rgba(0,180,0,0.35)', fontSize: 12, lineHeight: 1.8 }}>
                      <Flex alignItems="center" gap={8} style={{ marginBottom: 8 }}>
                        <span style={{ fontSize: 16 }}>⭐</span>
                        <Strong style={{ fontSize: 13 }}>Recommended: Dynatrace EdgeConnect</Strong>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(0,180,0,0.15)', color: '#2e7d32', fontWeight: 700 }}>BEST PRACTICE</span>
                      </Flex>
                      <div>
                        Dynatrace does not use static egress IP addresses for AppEngine traffic. The recommended solution is to set up <Strong>EdgeConnect</Strong> — a Dynatrace-managed network proxy.
                      </div>
                      <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: 'rgba(0,0,0,0.04)', border: `1px solid ${Colors.Border.Neutral.Default}` }}>
                        <Strong style={{ display: 'block', marginBottom: 4 }}>How it works:</Strong>
                        <div>1. Deploy an EdgeConnect instance in your network (or cloud VPC)</div>
                        <div>2. AppEngine traffic routes through the EdgeConnect</div>
                        <div>3. Whitelist the EdgeConnect's static IP on your host firewall</div>
                      </div>
                      <div style={{ marginTop: 8 }}>
                        📖 <a href="https://docs.dynatrace.com/docs/ingest-from/edgeconnect" target="_blank" rel="noopener noreferrer" style={{ color: '#2e7d32', fontWeight: 600 }}>EdgeConnect Documentation →</a>
                      </div>
                    </div>

                    {/* Alternative — Direct IP Approach */}
                    <div style={{ marginTop: 12, padding: 14, borderRadius: 10, background: 'rgba(181,137,0,0.06)', border: '1px solid rgba(181,137,0,0.3)', fontSize: 12, lineHeight: 1.8 }}>
                      <Flex alignItems="center" gap={8} style={{ marginBottom: 8 }}>
                        <span style={{ fontSize: 16 }}>🔧</span>
                        <Strong style={{ fontSize: 13 }}>Alternative: Direct IP Whitelisting</Strong>
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(181,137,0,0.15)', color: '#b58900', fontWeight: 700 }}>QUICK START</span>
                      </Flex>
                      <div>If you don't have EdgeConnect set up yet, you can temporarily whitelist the detected source IP. Note that this IP <Strong>may change</Strong> as Dynatrace scales its infrastructure.</div>

                      <div style={{ marginTop: 8 }}>
                        <Strong style={{ display: 'block', marginBottom: 4 }}>🌐 Host firewall / Security Group rules:</Strong>
                        <div><Strong>Port:</Strong> <code style={{ fontSize: 11, background: 'rgba(0,0,0,0.08)', padding: '1px 5px', borderRadius: 3 }}>8080</code> (or your configured port)</div>
                        <div><Strong>Protocol:</Strong> <code style={{ fontSize: 11, background: 'rgba(0,0,0,0.08)', padding: '1px 5px', borderRadius: 3 }}>TCP</code> · <Strong>Direction:</Strong> <code style={{ fontSize: 11, background: 'rgba(0,0,0,0.08)', padding: '1px 5px', borderRadius: 3 }}>Inbound</code></div>
                      </div>

                      <div style={{ marginTop: 6 }}><Strong>Source IP (who is connecting to your server):</Strong></div>
                      {detectedCallerIp ? (
                        <div style={{ marginTop: 4, padding: '10px 12px', background: 'rgba(0,180,0,0.08)', border: '1px solid rgba(0,180,0,0.3)', borderRadius: 6, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.8 }}>
                          ✅ <Strong>Detected source IP:</Strong> <code style={{ fontSize: 13, background: 'rgba(0,0,0,0.1)', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>{detectedCallerIp}</code><br/>
                          Whitelist <Strong>{detectedCallerIp}/32</Strong> for inbound TCP on port <Strong>{settingsForm.apiPort || '8080'}</Strong>.<br/>
                          <span style={{ opacity: 0.7 }}>⚠️ This IP may change — use EdgeConnect for a stable solution.</span>
                        </div>
                      ) : (
                        <div style={{ marginTop: 4, padding: '8px 10px', background: 'rgba(220,160,0,0.08)', border: '1px solid rgba(220,160,0,0.3)', borderRadius: 6, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.8 }}>
                          🔌 <Strong>Not yet detected.</Strong> Go to the <Strong>Config</Strong> tab and click <Strong>🔌 Test</Strong> to connect.<br/>
                          Once successful, the server will report the exact IP that reached it.<br/>
                          <span style={{ opacity: 0.7 }}>💡 If the test fails, temporarily open port {settingsForm.apiPort || '8080'} to <Strong>0.0.0.0/0</Strong>, test, then restrict to the detected IP.</span>
                        </div>
                      )}

                      <div style={{ marginTop: 8 }}><Strong>⚠️ For AWS Security Groups:</Strong></div>
                      <div style={{ marginTop: 4, padding: '8px 10px', background: 'rgba(0,0,0,0.06)', borderRadius: 6, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.8 }}>
                        Type: <Strong>Custom TCP</Strong><br/>
                        Port range: <Strong>{settingsForm.apiPort || '8080'}</Strong><br/>
                        Source: <Strong>{detectedCallerIp ? `${detectedCallerIp}/32` : '0.0.0.0/0 (open temporarily, then restrict)'}</Strong><br/>
                        Description: <Strong>BizObs Generator - Dynatrace AppEngine</Strong>
                      </div>
                    </div>

                    <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
                      <Strong>💡 Tip:</Strong> Your BizObs server host must have a <Strong>public IP</Strong> (or be reachable via EdgeConnect). Enter that IP in the <Strong>Host</Strong> field on the Config tab.
                    </div>
                  </div>
                </Flex>
              </div>

              {/* Quick Reference */}
              <div style={{ padding: 14, borderRadius: 10, background: 'rgba(0,161,201,0.06)', border: `1px solid ${Colors.Theme.Primary['70']}` }}>
                <Strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>💡 Quick Reference</Strong>
                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                  <div><Strong>⚙️ Settings</Strong> — Configure server host, port, and protocol</div>
                  <div><Strong>🖥️ Services</Strong> — View running & dormant services, stop/clear them</div>
                  <div><Strong>💤 Dormant</Strong> — Stopped services remembered for quick restart (ports freed)</div>
                  <div><Strong>📋 Templates</Strong> — Saved configurations in the sidebar for one-click loading</div>
                  <div><Strong>🔄 Refresh</Strong> — Re-fetch service status from the server</div>
                </div>
              </div>
            </div>
            ) : (
            /* ── EdgeConnect Setup Tab ─── */
            <div style={{ padding: 24 }}>
              {/* Status */}
              {ecStatus && (
                <div style={{ padding: 10, marginBottom: 16, borderRadius: 8, fontSize: 13, fontFamily: 'monospace',
                  background: ecStatus.includes('✅') ? 'rgba(115,190,40,0.12)' : ecStatus.includes('❌') ? 'rgba(220,50,47,0.12)' : 'rgba(0,161,201,0.12)',
                  border: `1px solid ${ecStatus.includes('✅') ? Colors.Theme.Success['70'] : ecStatus.includes('❌') ? '#dc322f' : Colors.Theme.Primary['70']}` }}>
                  {ecStatus}
                </div>
              )}

              {/* ── Step 1: Create EdgeConnect ── */}
              <div style={{ marginBottom: 16, padding: 16, borderRadius: 10, border: `1.5px solid ${Colors.Theme.Primary['70']}`, background: 'rgba(108,44,156,0.04)' }}>
                <Flex alignItems="flex-start" gap={12}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: `linear-gradient(135deg, ${Colors.Theme.Primary['70']}, #00d4ff)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>1</div>
                  <div style={{ flex: 1 }}>
                    <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 8 }}>
                      <Strong style={{ fontSize: 14 }}>Create EdgeConnect</Strong>
                      <a href={`${TENANT_URL}/ui/apps/dynatrace.settings/settings/external-requests/?tab=edge-connect`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#4169e1', textDecoration: 'none', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(65,105,225,0.25)', background: 'rgba(65,105,225,0.06)', fontWeight: 600 }}>or create manually in Settings →</a>
                    </Flex>
                    <Paragraph style={{ fontSize: 12, opacity: 0.7, marginBottom: 12, lineHeight: 1.5 }}>
                      Enter a name and your server IP. The app will create the EdgeConnect config and <Strong>auto-generate</Strong> OAuth credentials.
                    </Paragraph>

                    <Flex gap={8} style={{ marginBottom: 12 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Name</label>
                        <TextInput value={ecName} onChange={(v: string) => setEcName(v)} placeholder="bizobs" />
                      </div>
                      <div style={{ flex: 2 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Host Pattern / Server IP</label>
                        <TextInput value={ecHostPattern} onChange={(v: string) => setEcHostPattern(v)} placeholder={settingsForm.apiHost || '3.209.41.33'} />
                      </div>
                    </Flex>

                    {settingsForm.apiHost && !ecHostPattern && (
                      <button onClick={() => setEcHostPattern(settingsForm.apiHost)} style={{ marginBottom: 10, padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(108,44,156,0.3)', background: 'rgba(108,44,156,0.08)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>📋 Use saved host: {settingsForm.apiHost}</button>
                    )}

                    <Button variant="emphasized" onClick={createEdgeConnect} disabled={isCreatingEC} style={{ width: '100%', fontWeight: 600, fontSize: 13 }}>
                      {isCreatingEC ? '⏳ Creating...' : '🔌 Create EdgeConnect & Generate Credentials'}
                    </Button>

                    {/* Already have credentials? Manual entry */}
                    {!ecClientId && !ecClientSecret && (
                      <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(0,0,0,0.02)', border: `1px solid ${Colors.Border.Neutral.Default}`, fontSize: 11, opacity: 0.7 }}>
                        💡 Already created one in Dynatrace Settings? Enter the credentials manually below and skip to Step 2.
                      </div>
                    )}
                  </div>
                </Flex>
              </div>

              {/* ── Step 2: Generated Credentials + YAML ── */}
              {isAnyEcOnline && isEcRouteActive ? (
                /* ── Connected summary ── */
                <div style={{ marginBottom: 16, padding: 16, borderRadius: 10, border: '1px solid rgba(0,180,0,0.35)', background: 'rgba(0,180,0,0.04)' }}>
                  <Flex alignItems="flex-start" gap={12}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: `linear-gradient(135deg, #2e7d32, ${Colors.Theme.Success['70']})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>✓</div>
                    <div style={{ flex: 1 }}>
                      <Strong style={{ fontSize: 14 }}>EdgeConnect Connected</Strong>
                      <Paragraph style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                        Your EdgeConnect is <Strong style={{ color: '#2e7d32' }}>ONLINE</Strong> and routing traffic to <code style={{ fontSize: 11 }}>{ecHostPattern || apiSettings.host}</code>. No further action needed.
                      </Paragraph>
                    </div>
                  </Flex>
                </div>
              ) : (
                /* ── Credentials + YAML (before connection) ── */
                <div style={{ marginBottom: 16, padding: 16, borderRadius: 10, border: `1px solid ${ecClientId && ecClientSecret ? 'rgba(0,180,0,0.35)' : Colors.Border.Neutral.Default}`, background: ecClientId && ecClientSecret ? 'rgba(0,180,0,0.03)' : 'rgba(0,212,255,0.04)' }}>
                  <Flex alignItems="flex-start" gap={12}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: ecClientId && ecClientSecret ? `linear-gradient(135deg, #2e7d32, ${Colors.Theme.Success['70']})` : `linear-gradient(135deg, #00d4ff, ${Colors.Theme.Success['70']})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{ecClientId && ecClientSecret ? '✓' : '2'}</div>
                    <div style={{ flex: 1 }}>
                      <Strong style={{ fontSize: 14 }}>{ecClientId && ecClientSecret ? 'Credentials Ready — Deploy on Server' : 'Credentials & Deploy'}</Strong>

                      {ecClientId && ecClientSecret ? (
                        <>
                          <div style={{ marginTop: 10, marginBottom: 10, padding: 10, borderRadius: 8, background: 'rgba(220,50,47,0.06)', border: '1px solid rgba(220,50,47,0.25)', fontSize: 12 }}>
                            ⚠️ <Strong>Save the secret now!</Strong> It cannot be retrieved again after you leave this page.
                          </div>

                          {/* Editable credential fields */}
                          <Flex gap={8} style={{ marginBottom: 12 }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>Client ID</label>
                              <TextInput value={ecClientId} onChange={(v: string) => setEcClientId(v)} placeholder="dt0s10.XXXXXXXX" />
                            </div>
                          </Flex>
                          <div style={{ marginBottom: 12 }}>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>Client Secret</label>
                            <TextInput value={ecClientSecret} onChange={(v: string) => setEcClientSecret(v)} placeholder="dt0s10.XXXXXXXX.XXXXX..." />
                          </div>

                          {/* Generated YAML */}
                          <div style={{ marginBottom: 10 }}>
                            <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 4 }}>
                              <Strong style={{ fontSize: 11 }}>📄 edgeConnect.yaml</Strong>
                              <button onClick={() => { navigator.clipboard.writeText(generateEcYaml()); setEcStatus('📋 YAML copied!'); }} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.15)', background: 'rgba(255,255,255,0.9)', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>📋 Copy YAML</button>
                            </Flex>
                            <pre style={{ padding: 10, borderRadius: 8, background: 'rgba(0,0,0,0.05)', border: `1px solid ${Colors.Border.Neutral.Default}`, fontSize: 11, lineHeight: 1.5, overflow: 'auto', maxHeight: 180, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{generateEcYaml()}
                            </pre>
                          </div>

                          {/* Deploy command */}
                          <div>
                            <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 4 }}>
                              <Strong style={{ fontSize: 11 }}>🐳 Run on server</Strong>
                              <button onClick={() => { navigator.clipboard.writeText(`cd ~/BizObs\\ Generator\\ -\\ Dynatrace\\ AppEngine\\ App/edgeconnect && ./run-edgeconnect.sh`); setEcStatus('📋 Command copied!'); }} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.15)', background: 'rgba(255,255,255,0.9)', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>📋 Copy</button>
                            </Flex>
                            <pre style={{ padding: 10, borderRadius: 8, background: 'rgba(0,0,0,0.05)', border: `1px solid ${Colors.Border.Neutral.Default}`, fontSize: 11, lineHeight: 1.5, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
{`# Update the YAML on server, then start EdgeConnect:\ncd ~/BizObs\\ Generator\\ -\\ Dynatrace\\ AppEngine\\ App/edgeconnect\n./run-edgeconnect.sh`}
                            </pre>
                          </div>
                        </>
                      ) : (
                        <div style={{ marginTop: 8 }}>
                          <Paragraph style={{ fontSize: 12, opacity: 0.5, marginBottom: 10 }}>Click "Create EdgeConnect" above, or paste credentials from Dynatrace Settings manually:</Paragraph>
                          <Flex gap={8} style={{ marginBottom: 8 }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>Client ID</label>
                              <TextInput value={ecClientId} onChange={(v: string) => setEcClientId(v)} placeholder="dt0s10.XXXXXXXX" />
                            </div>
                          </Flex>
                          <div>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 3 }}>Client Secret</label>
                            <TextInput value={ecClientSecret} onChange={(v: string) => setEcClientSecret(v)} placeholder="dt0s10.XXXXXXXX.XXXXX..." />
                          </div>
                        </div>
                      )}
                    </div>
                  </Flex>
                </div>
              )}

              {/* ── Step 3: Verify Connection ── */}
              <div style={{ marginBottom: 16, padding: 16, borderRadius: 10, border: `1px solid ${isAnyEcOnline && isEcRouteActive ? 'rgba(0,180,0,0.35)' : Colors.Border.Neutral.Default}`, background: isAnyEcOnline && isEcRouteActive ? 'rgba(0,180,0,0.04)' : 'rgba(220,50,47,0.02)' }}>
                <Flex alignItems="flex-start" gap={12}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: isAnyEcOnline && isEcRouteActive ? `linear-gradient(135deg, #2e7d32, ${Colors.Theme.Success['70']})` : 'linear-gradient(135deg, #dc322f, #b58900)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{isAnyEcOnline && isEcRouteActive ? '✓' : '3'}</div>
                  <div style={{ flex: 1 }}>
                    <Strong style={{ fontSize: 14 }}>Verify & Connect</Strong>
                    <Paragraph style={{ fontSize: 12, opacity: 0.7, marginTop: 4, marginBottom: 12 }}>
                      {isAnyEcOnline && isEcRouteActive
                        ? 'EdgeConnect is online and routing traffic correctly.'
                        : <>After deploying on your server, check that the EdgeConnect is <Strong>ONLINE</Strong> and routing traffic correctly.</>}
                    </Paragraph>

                    <Flex gap={8} style={{ marginBottom: 12 }}>
                      <Button variant="emphasized" onClick={async () => { setEcStatus('⏳ Checking EdgeConnect status...'); await loadEdgeConnects(); await checkEdgeConnectMatch(); setEcStatus(''); }} disabled={isLoadingEC || isCheckingMatch} style={{ flex: 1, fontWeight: 600 }}>
                        {isLoadingEC || isCheckingMatch ? '⏳ Checking...' : '🔍 Check Connection'}
                      </Button>
                    </Flex>

                    {/* Route match result */}
                    {ecMatchResult && (
                      <div style={{ padding: 10, borderRadius: 8, fontSize: 12, background: ecMatchResult.matched ? 'rgba(0,180,0,0.08)' : 'rgba(220,160,0,0.08)', border: `1px solid ${ecMatchResult.matched ? 'rgba(0,180,0,0.3)' : 'rgba(220,160,0,0.3)'}` }}>
                        {ecMatchResult.matched ? (
                          <span>✅ <Strong>Route active!</Strong> Traffic to <code style={{ fontSize: 11 }}>{ecHostPattern || apiSettings.host}:{apiSettings.port || '8080'}</code> routes through <Strong>{ecMatchResult.name}</Strong> (pattern: <code style={{ fontSize: 11 }}>{ecMatchResult.pattern}</code>)</span>
                        ) : (
                          <span>⚠️ <Strong>No route match.</Strong> Ensure the EdgeConnect host pattern includes <code style={{ fontSize: 11 }}>{ecHostPattern || apiSettings.host || 'your server IP'}</code>.</span>
                        )}
                      </div>
                    )}

                    {!isLoadingEC && edgeConnects.length === 0 && !ecMatchResult && (
                      <div style={{ padding: 12, borderRadius: 8, background: 'rgba(220,160,0,0.06)', border: '1px solid rgba(220,160,0,0.2)', textAlign: 'center', fontSize: 12, opacity: 0.6 }}>
                        No EdgeConnects found yet. Complete steps 1-2 first.
                      </div>
                    )}
                  </div>
                </Flex>
              </div>
            </div>
            )}
          </div>
        </div>
      )}

      {/* ── Services Modal ─────────────────────────────── */}
      {showServicesModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} onClick={() => setShowServicesModal(false)} />
          <div style={{ position: 'relative', width: 720, maxHeight: '85vh', overflow: 'auto', background: Colors.Background.Surface.Default, borderRadius: 16, border: `2px solid ${Colors.Border.Neutral.Default}`, boxShadow: '0 24px 48px rgba(0,0,0,0.3)' }}>
            {/* Header */}
            <div style={{ padding: '16px 24px', background: 'linear-gradient(135deg, rgba(220,50,47,0.9), rgba(180,30,30,0.95))', borderRadius: '14px 14px 0 0' }}>
              <Flex alignItems="center" justifyContent="space-between">
                <Flex alignItems="center" gap={12}>
                  <span style={{ fontSize: 24 }}>🖥️</span>
                  <div>
                    <Strong style={{ color: 'white', fontSize: 16 }}>Running Services</Strong>
                    <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>Manage active child services</div>
                  </div>
                </Flex>
                <Flex alignItems="center" gap={8}>
                  {runningServices.length > 0 && (
                    <IntentButton
                      payload={getNotebookPayload(runningServices)}
                      options={{ recommendedAppId: 'dynatrace.notebooks', recommendedIntentId: 'view-query' }}
                    >
                      📓 Open in Notebook
                    </IntentButton>
                  )}
                  <button onClick={() => setShowServicesModal(false)} style={{ background: 'none', border: 'none', color: 'white', fontSize: 20, cursor: 'pointer', padding: 4 }}>✕</button>
                </Flex>
              </Flex>
            </div>

            <div style={{ padding: 24 }}>
              {/* Status */}
              {servicesStatus && (
                <div style={{ padding: 10, marginBottom: 16, borderRadius: 8, fontSize: 13, fontFamily: 'monospace',
                  background: servicesStatus.includes('✅') ? 'rgba(115,190,40,0.12)' : servicesStatus.includes('❌') ? 'rgba(220,50,47,0.12)' : 'rgba(0,161,201,0.12)',
                  border: `1px solid ${servicesStatus.includes('✅') ? Colors.Theme.Success['70'] : servicesStatus.includes('❌') ? '#dc322f' : Colors.Theme.Primary['70']}` }}>
                  {servicesStatus}
                </div>
              )}

              {isLoadingServices ? (
                <Flex justifyContent="center" style={{ padding: 32 }}><span style={{ fontSize: 32 }}>⏳</span></Flex>
              ) : runningServices.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, opacity: 0.6 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🟢</div>
                  <Paragraph>No services currently running.</Paragraph>
                </div>
              ) : (
                <>
                  {/* Group by company */}
                  {(() => {
                    const groups: Record<string, RunningService[]> = {};
                    runningServices.forEach(s => {
                      const company = s.companyName || (s.service.includes('-') ? s.service.split('-').pop()! : 'Unknown');
                      if (!groups[company]) groups[company] = [];
                      groups[company].push(s);
                    });
                    return Object.entries(groups).map(([company, services]) => (
                      <div key={company} style={{ marginBottom: 16, border: `1px solid ${Colors.Border.Neutral.Default}`, borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ padding: '10px 16px', background: 'rgba(0,161,201,0.08)', borderBottom: `1px solid ${Colors.Border.Neutral.Default}` }}>
                          <Flex alignItems="center" justifyContent="space-between">
                            <Flex alignItems="center" gap={8}>
                              <span style={{ fontSize: 16 }}>🏢</span>
                              <Strong style={{ fontSize: 14 }}>{company}</Strong>
                              <span style={{ fontSize: 12, opacity: 0.6 }}>({services.length} service{services.length !== 1 ? 's' : ''})</span>
                              {services[0]?.releaseStage && (
                                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(108,44,156,0.15)', color: '#6c2c9c', fontFamily: 'monospace' }}>
                                  stage:{services[0].releaseStage}
                                </span>
                              )}
                            </Flex>
                            <Flex gap={4}>
                              <Button onClick={() => stopCompanyServices(company)} disabled={isStoppingServices} style={{ fontSize: 12, padding: '4px 12px' }}>
                                {stoppingCompany === company ? `⏳ Stopping ${company}...` : `🛑 Stop ${company}`}
                              </Button>
                            </Flex>
                          </Flex>
                        </div>
                        <div style={{ padding: 12 }}>
                          {services.map(s => (
                            <Flex key={s.pid} alignItems="center" justifyContent="space-between" style={{ padding: '6px 8px', borderRadius: 6, marginBottom: 4, background: s.running ? 'rgba(115,190,40,0.06)' : 'rgba(220,50,47,0.06)' }}>
                              <Flex alignItems="center" gap={8}>
                                <span style={{ fontSize: 10, color: s.running ? Colors.Theme.Success['70'] : '#dc322f' }}>●</span>
                                <span style={{ fontSize: 13 }}>{s.baseServiceName || s.service}</span>
                                {s.serviceVersion && (
                                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(115,190,40,0.15)', color: Colors.Theme.Success['70'], fontFamily: 'monospace', fontWeight: 600 }}>
                                    v{s.serviceVersion}.0.0
                                  </span>
                                )}
                              </Flex>
                              <Flex alignItems="center" gap={8}>
                                <span style={{ fontSize: 10, opacity: 0.4, fontFamily: 'monospace' }}>:{s.port || '?'}</span>
                                <span style={{ fontSize: 11, opacity: 0.5, fontFamily: 'monospace' }}>PID {s.pid}</span>
                              </Flex>
                            </Flex>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </>
              )}

              {/* Actions */}
              <Flex gap={8} style={{ marginTop: 16 }}>
                <Button onClick={() => { loadRunningServices(); loadDormantServices(); }} disabled={isLoadingServices} style={{ flex: 1 }}>🔄 Refresh</Button>
                {runningServices.length > 0 && (
                  <Button onClick={stopAllServices} disabled={isStoppingServices} style={{ flex: 1, background: 'rgba(220,50,47,0.15)', color: '#dc322f' }}>
                    {isStoppingServices ? '🛑 Stopping...' : '🛑 Stop All Services'}
                  </Button>
                )}
              </Flex>

              {/* ── Dormant Services Section ──── */}
              <div style={{ marginTop: 24, borderTop: `1px solid ${Colors.Border.Neutral.Default}`, paddingTop: 20 }}>
                <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 12 }}>
                  <Flex alignItems="center" gap={8}>
                    <span style={{ fontSize: 18 }}>💤</span>
                    <Strong style={{ fontSize: 14 }}>Dormant Services</Strong>
                    <span style={{ fontSize: 12, opacity: 0.5 }}>({dormantServices.length})</span>
                  </Flex>
                  {dormantServices.length > 0 && (
                    <Button onClick={() => setShowDormantWarning('all')} disabled={isClearingDormant} style={{ fontSize: 12, padding: '4px 14px', background: 'rgba(220,160,0,0.12)', color: '#b58900' }}>
                      {isClearingDormant ? '🧹 Clearing...' : '🧹 Clear All Dormant'}
                    </Button>
                  )}
                </Flex>

                {isLoadingDormant ? (
                  <Flex justifyContent="center" style={{ padding: 16 }}><span style={{ fontSize: 20 }}>⏳</span></Flex>
                ) : dormantServices.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 16, opacity: 0.5, fontSize: 13 }}>
                    No dormant services. Services that are stopped will appear here for quick restart.
                  </div>
                ) : (
                  <>
                    {/* Group dormant by company */}
                    {(() => {
                      const groups: Record<string, any[]> = {};
                      dormantServices.forEach((s: any) => {
                        const company = s.companyName || 'Unknown';
                        if (!groups[company]) groups[company] = [];
                        groups[company].push(s);
                      });
                      return Object.entries(groups).map(([company, services]) => (
                        <div key={`dormant-${company}`} style={{ marginBottom: 12, border: `1px dashed rgba(181,137,0,0.4)`, borderRadius: 10, overflow: 'hidden' }}>
                          <div style={{ padding: '8px 14px', background: 'rgba(181,137,0,0.06)', borderBottom: `1px dashed rgba(181,137,0,0.3)` }}>
                            <Flex alignItems="center" justifyContent="space-between">
                              <Flex alignItems="center" gap={8}>
                                <span style={{ fontSize: 14 }}>💤</span>
                                <Strong style={{ fontSize: 13 }}>{company}</Strong>
                                <span style={{ fontSize: 11, opacity: 0.5 }}>({services.length} dormant)</span>
                              </Flex>
                              <Button onClick={() => setShowDormantWarning(company)} disabled={clearingDormantCompany === company} style={{ fontSize: 10, padding: '2px 8px', background: 'rgba(220,160,0,0.1)', color: '#b58900' }}>
                                {clearingDormantCompany === company ? '⏳...' : '🧹 Clear'}
                              </Button>
                            </Flex>
                          </div>
                          <div style={{ padding: 10 }}>
                            {services.map((s: any, idx: number) => (
                              <Flex key={idx} alignItems="center" justifyContent="space-between" style={{ padding: '5px 8px', borderRadius: 6, marginBottom: 3, background: 'rgba(181,137,0,0.04)' }}>
                                <Flex alignItems="center" gap={8}>
                                  <span style={{ fontSize: 10, color: '#b58900' }}>○</span>
                                  <span style={{ fontSize: 12 }}>{s.baseServiceName || s.serviceName}</span>
                                  {s.serviceVersion && (
                                    <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(181,137,0,0.1)', color: '#b58900', fontFamily: 'monospace' }}>
                                      v{s.serviceVersion}
                                    </span>
                                  )}
                                </Flex>
                                <span style={{ fontSize: 10, opacity: 0.4, fontFamily: 'monospace' }}>port {s.previousPort}</span>
                              </Flex>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Dormant Warning Confirmation Modal ──── */}
      {showDormantWarning && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowDormantWarning(null)} />
          <div style={{ position: 'relative', width: 440, background: Colors.Background.Surface.Default, borderRadius: 14, border: `2px solid #b58900`, boxShadow: '0 16px 40px rgba(0,0,0,0.3)' }}>
            <div style={{ padding: '16px 20px', background: 'linear-gradient(135deg, rgba(181,137,0,0.15), rgba(220,160,0,0.1))', borderRadius: '12px 12px 0 0', borderBottom: `1px solid rgba(181,137,0,0.3)` }}>
              <Flex alignItems="center" gap={8}>
                <span style={{ fontSize: 22 }}>⚠️</span>
                <Strong style={{ fontSize: 15 }}>Clear Dormant Services</Strong>
              </Flex>
            </div>
            <div style={{ padding: 20 }}>
              <Paragraph style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>
                {showDormantWarning === 'all'
                  ? 'You are about to clear ALL dormant services.'
                  : `You are about to clear dormant services for "${showDormantWarning}".`}
              </Paragraph>
              <div style={{ padding: 12, borderRadius: 8, background: 'rgba(220,50,47,0.08)', border: '1px solid rgba(220,50,47,0.3)', marginBottom: 16 }}>
                <Strong style={{ fontSize: 12, color: '#dc322f', display: 'block', marginBottom: 6 }}>⚠️ Duplicate Service Warning</Strong>
                <Paragraph style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5, margin: 0 }}>
                  If you re-enable these services within <Strong>24 hours</Strong>, Dynatrace may detect them as <Strong>duplicate services</Strong> because OneAgent remembers the previous process group. This can cause:
                </Paragraph>
                <ul style={{ fontSize: 11, opacity: 0.8, margin: '6px 0 0 0', paddingLeft: 20, lineHeight: 1.6 }}>
                  <li>Split service metrics (old vs new instance)</li>
                  <li>Confusing service topology in Smartscape</li>
                  <li>Duplicate entries in the Services screen</li>
                </ul>
                <Paragraph style={{ fontSize: 12, opacity: 0.85, marginTop: 8, marginBottom: 0 }}>
                  <Strong>Tip:</Strong> Use the <code style={{ fontSize: 11, background: 'rgba(0,0,0,0.1)', padding: '1px 4px', borderRadius: 3 }}>version</code> and <code style={{ fontSize: 11, background: 'rgba(0,0,0,0.1)', padding: '1px 4px', borderRadius: 3 }}>stage</code> tags in Dynatrace to filter by generation.
                </Paragraph>
              </div>
              <Flex gap={8}>
                <Button onClick={() => setShowDormantWarning(null)} style={{ flex: 1 }}>Cancel</Button>
                <Button onClick={() => showDormantWarning === 'all' ? clearAllDormantServices() : clearCompanyDormantServices(showDormantWarning)} style={{ flex: 1, background: 'rgba(220,50,47,0.15)', color: '#dc322f', fontWeight: 600 }}>
                  🗑️ Clear {showDormantWarning === 'all' ? 'All' : showDormantWarning} Dormant
                </Button>
              </Flex>
            </div>
          </div>
        </div>
      )}

      {/* ── Chaos Gremlin Agent Modal ─────────────────────────────── */}
      {showChaosModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} onClick={() => setShowChaosModal(false)} />
          <div style={{ position: 'relative', width: 760, maxHeight: '85vh', overflow: 'auto', background: Colors.Background.Surface.Default, borderRadius: 16, border: '2px solid rgba(181,137,0,0.5)', boxShadow: '0 24px 48px rgba(0,0,0,0.3)' }}>
            {/* Header */}
            <div style={{ padding: '16px 24px', background: 'linear-gradient(135deg, rgba(107,142,35,0.85), rgba(181,137,0,0.9))', borderRadius: '14px 14px 0 0' }}>
              <Flex alignItems="center" justifyContent="space-between">
                <Flex alignItems="center" gap={12}>
                  <svg width="32" height="32" viewBox="0 0 64 64">
                    <circle cx="32" cy="34" r="22" fill="#6b8e23"/>
                    <ellipse cx="22" cy="28" rx="6" ry="7" fill="white"/>
                    <ellipse cx="42" cy="28" rx="6" ry="7" fill="white"/>
                    <circle cx="23" cy="28" r="3.5" fill="#dc322f"/>
                    <circle cx="43" cy="28" r="3.5" fill="#dc322f"/>
                    <path d="M22 42 Q32 50 42 42" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                    <rect x="24" y="42" width="3" height="4" rx="1" fill="white" transform="rotate(-8 25.5 44)"/>
                    <rect x="30.5" y="43" width="3" height="4.5" rx="1" fill="white"/>
                    <rect x="37" y="42" width="3" height="4" rx="1" fill="white" transform="rotate(8 38.5 44)"/>
                    <path d="M14 16 Q18 24 22 22" stroke="#6b8e23" strokeWidth="3" fill="none" strokeLinecap="round"/>
                    <path d="M50 16 Q46 24 42 22" stroke="#6b8e23" strokeWidth="3" fill="none" strokeLinecap="round"/>
                    <ellipse cx="12" cy="14" rx="4" ry="5" fill="#6b8e23"/>
                    <ellipse cx="52" cy="14" rx="4" ry="5" fill="#6b8e23"/>
                  </svg>
                  <div>
                    <Strong style={{ color: 'white', fontSize: 16 }}>Chaos Gremlin Agent</Strong>
                    <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>Inject faults · Test resilience · Observe recovery</div>
                  </div>
                </Flex>
                <Flex alignItems="center" gap={8}>
                  <button onClick={loadChaosData} disabled={isLoadingChaos} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: 'white', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
                    {isLoadingChaos ? '⏳' : '🔄'} Refresh
                  </button>
                  <button onClick={() => setShowChaosModal(false)} style={{ background: 'none', border: 'none', color: 'white', fontSize: 20, cursor: 'pointer', padding: 4 }}>✕</button>
                </Flex>
              </Flex>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${Colors.Border.Neutral.Default}`, background: 'rgba(181,137,0,0.04)' }}>
              {([
                { key: 'active', label: '🔥 Active Faults', badge: activeFaults.length },
                { key: 'inject', label: '💉 Inject' },
                { key: 'targeted', label: '🎯 Targeted', badge: Object.keys(targetedServices).length },
                { key: 'smart', label: '🤖 Smart Chaos' },
              ] as { key: typeof chaosTab; label: string; badge?: number }[]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setChaosTab(tab.key)}
                  style={{
                    flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: chaosTab === tab.key ? 700 : 500,
                    background: chaosTab === tab.key ? 'rgba(181,137,0,0.12)' : 'transparent',
                    borderBottom: chaosTab === tab.key ? '2px solid #b58900' : '2px solid transparent',
                    color: chaosTab === tab.key ? '#b58900' : 'inherit',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {tab.label}
                  {tab.badge != null && tab.badge > 0 && (
                    <span style={{ marginLeft: 6, background: '#dc322f', color: 'white', borderRadius: 8, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{tab.badge}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Status bar */}
            {chaosStatus && (
              <div style={{ padding: '8px 24px', fontSize: 12, fontFamily: 'monospace',
                background: chaosStatus.includes('✅') ? 'rgba(115,190,40,0.1)' : chaosStatus.includes('❌') ? 'rgba(220,50,47,0.1)' : chaosStatus.includes('⚠️') ? 'rgba(181,137,0,0.1)' : 'rgba(0,161,201,0.08)',
                borderBottom: `1px solid ${Colors.Border.Neutral.Default}` }}>
                {chaosStatus}
              </div>
            )}

            <div style={{ padding: 24 }}>
              {isLoadingChaos ? (
                <Flex justifyContent="center" style={{ padding: 32 }}><span style={{ fontSize: 32 }}>⏳</span></Flex>
              ) : (
                <>
                  {/* ─── Tab 1: Active Faults ─── */}
                  {chaosTab === 'active' && (
                    <div>
                      {activeFaults.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>
                          <div style={{ fontSize: 48, marginBottom: 12 }}>😇</div>
                          <Paragraph>No active faults. All services running clean.</Paragraph>
                        </div>
                      ) : (
                        <>
                          {activeFaults.map((fault: any, idx: number) => (
                            <div key={fault.id || idx} style={{ marginBottom: 12, border: `1px solid rgba(220,50,47,0.3)`, borderRadius: 10, overflow: 'hidden' }}>
                              <div style={{ padding: '10px 16px', background: 'rgba(220,50,47,0.06)' }}>
                                <Flex alignItems="center" justifyContent="space-between">
                                  <Flex alignItems="center" gap={8}>
                                    <span style={{ fontSize: 16 }}>🔥</span>
                                    <div>
                                      <Strong style={{ fontSize: 13 }}>{fault.type || 'unknown'}</Strong>
                                      {fault.target && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>→ {fault.target}</span>}
                                    </div>
                                  </Flex>
                                  <button
                                    onClick={() => revertFault(fault.id)}
                                    disabled={isRevertingChaos}
                                    style={{ background: 'rgba(115,190,40,0.12)', border: '1px solid rgba(115,190,40,0.4)', color: Colors.Theme.Success['70'], borderRadius: 6, padding: '4px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                                  >
                                    {isRevertingChaos ? '⏳' : '↩️'} Revert
                                  </button>
                                </Flex>
                              </div>
                              <div style={{ padding: '8px 16px', display: 'flex', gap: 16, fontSize: 11, opacity: 0.7, fontFamily: 'monospace' }}>
                                {fault.intensity != null && <span>intensity: {fault.intensity}</span>}
                                {fault.durationMs != null && <span>duration: {Math.round(fault.durationMs / 1000)}s</span>}
                                {fault.injectedAt && <span>injected: {new Date(fault.injectedAt).toLocaleTimeString()}</span>}
                                {fault.status && <span>status: {fault.status}</span>}
                              </div>
                            </div>
                          ))}
                          <div style={{ marginTop: 16 }}>
                            <button
                              onClick={revertAllFaults}
                              disabled={isRevertingChaos}
                              style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: '2px solid rgba(220,50,47,0.5)', background: 'rgba(220,50,47,0.08)', color: '#dc322f', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
                            >
                              {isRevertingChaos ? '⏳ Reverting...' : '🚨 Revert All Faults (Panic)'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* ─── Tab 2: Inject ─── */}
                  {chaosTab === 'inject' && (
                    <div>
                      {/* Target Mode Toggle */}
                      <div style={{ marginBottom: 16 }}>
                        <Strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>🎯 Target Mode</Strong>
                        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${Colors.Border.Neutral.Default}` }}>
                          <button
                            onClick={() => { setInjectTargetMode('service'); setInjectForm(prev => ({ ...prev, target: '', company: '' })); }}
                            style={{
                              flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: injectTargetMode === 'service' ? 700 : 400,
                              background: injectTargetMode === 'service' ? 'rgba(181,137,0,0.15)' : 'transparent',
                              color: injectTargetMode === 'service' ? '#b58900' : 'inherit',
                            }}
                          >
                            🔧 Single Service
                          </button>
                          <button
                            onClick={() => { setInjectTargetMode('journey'); setInjectForm(prev => ({ ...prev, target: '', company: '' })); }}
                            style={{
                              flex: 1, padding: '8px 0', border: 'none', borderLeft: `1px solid ${Colors.Border.Neutral.Default}`, cursor: 'pointer', fontSize: 13, fontWeight: injectTargetMode === 'journey' ? 700 : 400,
                              background: injectTargetMode === 'journey' ? 'rgba(181,137,0,0.15)' : 'transparent',
                              color: injectTargetMode === 'journey' ? '#b58900' : 'inherit',
                            }}
                          >
                            🗺️ Whole Journey
                          </button>
                        </div>
                      </div>

                      {/* Target Dropdown — changes based on mode */}
                      <div style={{ marginBottom: 16 }}>
                        {injectTargetMode === 'service' ? (
                          <>
                            <Strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>🔧 Target Service</Strong>
                            <select
                              value={injectForm.target}
                              onChange={e => setInjectForm(prev => ({ ...prev, target: e.target.value }))}
                              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${Colors.Border.Neutral.Default}`, background: Colors.Background.Surface.Default, color: 'inherit', fontSize: 13 }}
                            >
                              <option value="">— Select a service —</option>
                              {runningServices.map((s: any) => (
                                <option key={s.pid || s.service} value={s.baseServiceName || s.service}>{s.baseServiceName || s.service} ({s.companyName || 'unknown'})</option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <>
                            <Strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>🗺️ Target Journey (Company)</Strong>
                            <select
                              value={injectForm.company}
                              onChange={e => setInjectForm(prev => ({ ...prev, company: e.target.value }))}
                              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${Colors.Border.Neutral.Default}`, background: Colors.Background.Surface.Default, color: 'inherit', fontSize: 13 }}
                            >
                              <option value="">— Select a journey —</option>
                              {(() => {
                                const companies = [...new Set(runningServices.map((s: any) => s.companyName).filter(Boolean))];
                                return companies.map(c => {
                                  const count = runningServices.filter((s: any) => s.companyName === c).length;
                                  return <option key={c} value={c}>{c} ({count} service{count !== 1 ? 's' : ''})</option>;
                                });
                              })()}
                            </select>
                            {injectForm.company && (
                              <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(181,137,0,0.06)', border: '1px solid rgba(181,137,0,0.2)', fontSize: 11, opacity: 0.8 }}>
                                👹 Gremlin will target <Strong>all services</Strong> for {injectForm.company}:
                                <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                  {runningServices.filter((s: any) => s.companyName === injectForm.company).map((s: any) => (
                                    <span key={s.pid || s.service} style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(181,137,0,0.1)', fontFamily: 'monospace', fontSize: 10 }}>
                                      {s.baseServiceName || s.service}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* Chaos Type */}
                      <div style={{ marginBottom: 16 }}>
                        <Strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>⚡ Chaos Type</Strong>
                        <select
                          value={injectForm.type}
                          onChange={e => setInjectForm(prev => ({ ...prev, type: e.target.value }))}
                          style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${Colors.Border.Neutral.Default}`, background: Colors.Background.Surface.Default, color: 'inherit', fontSize: 13 }}
                        >
                          <option value="enable_errors">🔴 Enable Errors — Turn on error injection</option>
                          <option value="increase_error_rate">📈 Increase Error Rate — Raise error rate</option>
                          <option value="slow_responses">🐌 Slow Responses — Add latency</option>
                          <option value="disable_circuit_breaker">💥 Disable Circuit Breaker — Remove protection</option>
                          <option value="disable_cache">🗑️ Disable Cache — Increase load</option>
                          <option value="target_company">🏢 Target Company — Focus on specific company</option>
                          <option value="custom_flag">🏴 Custom Flag — Set any feature flag</option>
                        </select>
                      </div>

                      {/* Intensity */}
                      <div style={{ marginBottom: 16 }}>
                        <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: 6 }}>
                          <Strong style={{ fontSize: 12 }}>🔥 Intensity</Strong>
                          <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: injectForm.intensity >= 8 ? '#dc322f' : injectForm.intensity >= 5 ? '#b58900' : Colors.Theme.Success['70'] }}>
                            {injectForm.intensity}/10 ({injectForm.intensity * 10}%)
                          </span>
                        </Flex>
                        <input
                          type="range"
                          min={1} max={10} step={1}
                          value={injectForm.intensity}
                          onChange={e => setInjectForm(prev => ({ ...prev, intensity: Number(e.target.value) }))}
                          style={{ width: '100%', accentColor: '#b58900' }}
                        />
                        <Flex justifyContent="space-between" style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>
                          <span>1 — Low</span><span>5 — Moderate</span><span>10 — Catastrophic</span>
                        </Flex>
                      </div>

                      {/* Duration */}
                      <div style={{ marginBottom: 20 }}>
                        <Strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>⏱️ Duration (seconds)</Strong>
                        <Flex gap={8} alignItems="center">
                          <input
                            type="number"
                            min={10} max={3600}
                            value={injectForm.duration}
                            onChange={e => setInjectForm(prev => ({ ...prev, duration: Number(e.target.value) }))}
                            style={{ width: 100, padding: '8px 12px', borderRadius: 8, border: `1px solid ${Colors.Border.Neutral.Default}`, background: Colors.Background.Surface.Default, color: 'inherit', fontSize: 13 }}
                          />
                          <Flex gap={4}>
                            {[30, 60, 120, 300].map(d => (
                              <button key={d} onClick={() => setInjectForm(prev => ({ ...prev, duration: d }))}
                                style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${injectForm.duration === d ? '#b58900' : Colors.Border.Neutral.Default}`, background: injectForm.duration === d ? 'rgba(181,137,0,0.15)' : 'transparent', color: injectForm.duration === d ? '#b58900' : 'inherit', cursor: 'pointer', fontSize: 11, fontWeight: injectForm.duration === d ? 700 : 400 }}
                              >{d < 60 ? `${d}s` : `${d / 60}m`}</button>
                            ))}
                          </Flex>
                        </Flex>
                      </div>

                      {/* Inject Button */}
                      {(() => {
                        const hasTarget = injectTargetMode === 'service' ? !!injectForm.target : !!injectForm.company;
                        return (
                          <button
                            onClick={injectChaos}
                            disabled={isInjectingChaos || !hasTarget}
                            style={{
                              width: '100%', padding: '12px 0', borderRadius: 10,
                              border: '2px solid rgba(181,137,0,0.6)',
                              background: !hasTarget ? 'rgba(128,128,128,0.1)' : 'linear-gradient(135deg, rgba(181,137,0,0.15), rgba(220,50,47,0.1))',
                              color: !hasTarget ? 'rgba(128,128,128,0.5)' : '#b58900',
                              fontWeight: 700, fontSize: 15, cursor: hasTarget ? 'pointer' : 'not-allowed',
                              transition: 'all 0.2s ease',
                            }}
                          >
                            {isInjectingChaos ? '⏳ Injecting...' : '👹 Unleash Gremlin'}
                          </button>
                        );
                      })()}
                    </div>
                  )}

                  {/* ─── Tab 3: Targeted Services ─── */}
                  {chaosTab === 'targeted' && (
                    <div>
                      {Object.keys(targetedServices).length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>
                          <div style={{ fontSize: 48, marginBottom: 12 }}>🎯</div>
                          <Paragraph>No per-service overrides active.</Paragraph>
                          <div style={{ fontSize: 12, marginTop: 8, opacity: 0.7 }}>When you inject faults targeting specific services, their overrides will appear here.</div>
                        </div>
                      ) : (
                        <>
                          {Object.entries(targetedServices).map(([serviceName, flags]: [string, any]) => (
                            <div key={serviceName} style={{ marginBottom: 12, border: `1px solid rgba(181,137,0,0.3)`, borderRadius: 10, overflow: 'hidden' }}>
                              <div style={{ padding: '10px 16px', background: 'rgba(181,137,0,0.06)' }}>
                                <Flex alignItems="center" justifyContent="space-between">
                                  <Flex alignItems="center" gap={8}>
                                    <span style={{ fontSize: 16 }}>🎯</span>
                                    <Strong style={{ fontSize: 13 }}>{serviceName}</Strong>
                                  </Flex>
                                  <button
                                    onClick={() => removeTargetedService(serviceName)}
                                    style={{ background: 'rgba(220,50,47,0.1)', border: '1px solid rgba(220,50,47,0.3)', color: '#dc322f', borderRadius: 6, padding: '4px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                                  >
                                    🗑️ Remove
                                  </button>
                                </Flex>
                              </div>
                              <div style={{ padding: '8px 16px' }}>
                                {typeof flags === 'object' && flags !== null ? (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {Object.entries(flags).map(([flag, value]: [string, any]) => (
                                      <span key={flag} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(181,137,0,0.08)', border: '1px solid rgba(181,137,0,0.2)', fontFamily: 'monospace' }}>
                                        {flag}: <Strong>{String(value)}</Strong>
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span style={{ fontSize: 12, opacity: 0.6, fontFamily: 'monospace' }}>{JSON.stringify(flags)}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}

                  {/* ─── Tab 4: Smart Chaos ─── */}
                  {chaosTab === 'smart' && (
                    <div>
                      <div style={{ textAlign: 'center', marginBottom: 20 }}>
                        <span style={{ fontSize: 40 }}>🤖</span>
                        <div style={{ fontSize: 14, marginTop: 8, opacity: 0.8 }}>Describe what you want to break in plain English.</div>
                        <div style={{ fontSize: 12, marginTop: 4, opacity: 0.5 }}>The AI agent will pick the right recipe, target, intensity, and duration.</div>
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <textarea
                          value={smartChaosGoal}
                          onChange={e => setSmartChaosGoal(e.target.value)}
                          placeholder="e.g. &quot;Cause high errors on the checkout service for 2 minutes&quot; or &quot;Slow down all services to test circuit breakers&quot;"
                          rows={3}
                          style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: `1px solid ${Colors.Border.Neutral.Default}`, background: Colors.Background.Surface.Default, color: 'inherit', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                        />
                      </div>

                      <button
                        onClick={runSmartChaos}
                        disabled={isSmartChaosRunning || !smartChaosGoal.trim()}
                        style={{
                          width: '100%', padding: '12px 0', borderRadius: 10,
                          border: '2px solid rgba(0,161,201,0.5)',
                          background: !smartChaosGoal.trim() ? 'rgba(128,128,128,0.1)' : 'linear-gradient(135deg, rgba(0,161,201,0.15), rgba(108,44,156,0.1))',
                          color: !smartChaosGoal.trim() ? 'rgba(128,128,128,0.5)' : Colors.Theme.Primary['70'],
                          fontWeight: 700, fontSize: 15, cursor: smartChaosGoal.trim() ? 'pointer' : 'not-allowed',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        {isSmartChaosRunning ? '⏳ AI is thinking...' : '🤖 Run Smart Chaos'}
                      </button>

                      {/* Example goals */}
                      <div style={{ marginTop: 20 }}>
                        <Strong style={{ fontSize: 11, display: 'block', marginBottom: 8, opacity: 0.5 }}>EXAMPLE GOALS</Strong>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {[
                            'Cause high errors on the payment service for 2 minutes',
                            'Slow down all services to test timeout handling',
                            'Disable circuit breakers to see error propagation',
                            'Target Acme Corp with intermittent errors',
                            'Run a moderate cache failure for 5 minutes',
                          ].map((example, idx) => (
                            <button
                              key={idx}
                              onClick={() => setSmartChaosGoal(example)}
                              style={{ textAlign: 'left', padding: '8px 12px', borderRadius: 8, border: `1px solid ${Colors.Border.Neutral.Default}`, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12, opacity: 0.7, transition: 'all 0.15s ease' }}
                              onMouseOver={e => { e.currentTarget.style.background = 'rgba(0,161,201,0.08)'; e.currentTarget.style.opacity = '1'; }}
                              onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = '0.7'; }}
                            >
                              💡 {example}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Get Started Checklist Modal ─────────────────── */}
      {showGetStartedModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} onClick={() => setShowGetStartedModal(false)} />
          <div style={{ position: 'relative', width: 640, maxHeight: '85vh', overflow: 'auto', background: Colors.Background.Surface.Default, borderRadius: 16, border: '2px solid rgba(108,44,156,0.5)', boxShadow: '0 24px 48px rgba(0,0,0,0.3)' }}>
            {/* Header */}
            <div style={{ padding: '16px 24px', background: 'linear-gradient(135deg, #6c2c9c, #00a1c9)', borderRadius: '14px 14px 0 0' }}>
              <Flex alignItems="center" justifyContent="space-between">
                <Flex alignItems="center" gap={12}>
                  <span style={{ fontSize: 24 }}>🚀</span>
                  <div>
                    <Strong style={{ color: 'white', fontSize: 16 }}>Get Started</Strong>
                    <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{completedCount}/{totalSteps} steps completed</div>
                  </div>
                </Flex>
                <Flex alignItems="center" gap={8}>
                  {/* Progress bar */}
                  <div style={{ width: 120, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.2)', overflow: 'hidden' }}>
                    <div style={{ width: `${(completedCount / totalSteps) * 100}%`, height: '100%', borderRadius: 4, background: completedCount === totalSteps ? '#73be28' : 'white', transition: 'width 0.3s ease' }} />
                  </div>
                  <button onClick={() => setShowGetStartedModal(false)} style={{ background: 'none', border: 'none', color: 'white', fontSize: 20, cursor: 'pointer', padding: 4 }}>✕</button>
                </Flex>
              </Flex>
            </div>

            <div style={{ padding: 24 }}>
              {/* ── Section: Server Setup ── */}
              <div style={{ marginBottom: 20 }}>
                <Flex alignItems="center" gap={6} style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 14 }}>🖥️</span>
                  <Strong style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>Server Setup</Strong>
                </Flex>

                {/* Step: Configure Server IP */}
                <div onClick={() => toggleCheck('server-ip')} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${checklist['server-ip'] ? 'rgba(0,180,0,0.3)' : Colors.Border.Neutral.Default}`, background: checklist['server-ip'] ? 'rgba(0,180,0,0.04)' : 'transparent', cursor: 'pointer', marginBottom: 8, transition: 'all 0.2s' }}>
                  <Flex alignItems="center" gap={12}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${isStepComplete('server-ip') ? '#2e7d32' : Colors.Border.Neutral.Default}`, background: isStepComplete('server-ip') ? '#2e7d32' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
                      {isStepComplete('server-ip') && <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <Strong style={{ fontSize: 13, textDecoration: isStepComplete('server-ip') ? 'line-through' : 'none', opacity: isStepComplete('server-ip') ? 0.6 : 1 }}>Configure Server IP & Port</Strong>
                      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>Set your BizObs Generator server host and port in Settings → Config tab</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); openSettingsModal(); setShowGetStartedModal(false); }} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${Colors.Theme.Primary['70']}`, background: 'rgba(108,44,156,0.08)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: Colors.Theme.Primary['70'] }}>⚙️ Settings</button>
                  </Flex>
                </div>
              </div>

              {/* ── Section: Network / EdgeConnect ── */}
              <div style={{ marginBottom: 20 }}>
                <Flex alignItems="center" gap={6} style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 14 }}>🔌</span>
                  <Strong style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>Network — EdgeConnect</Strong>
                </Flex>

                {/* Step: Create EdgeConnect */}
                <div onClick={() => toggleCheck('edgeconnect-create')} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${checklist['edgeconnect-create'] ? 'rgba(0,180,0,0.3)' : Colors.Border.Neutral.Default}`, background: checklist['edgeconnect-create'] ? 'rgba(0,180,0,0.04)' : 'transparent', cursor: 'pointer', marginBottom: 8, transition: 'all 0.2s' }}>
                  <Flex alignItems="center" gap={12}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${isStepComplete('edgeconnect-create') ? '#2e7d32' : Colors.Border.Neutral.Default}`, background: isStepComplete('edgeconnect-create') ? '#2e7d32' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
                      {isStepComplete('edgeconnect-create') && <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <Strong style={{ fontSize: 13, textDecoration: isStepComplete('edgeconnect-create') ? 'line-through' : 'none', opacity: isStepComplete('edgeconnect-create') ? 0.6 : 1 }}>Create EdgeConnect in Dynatrace</Strong>
                      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>Open Dynatrace Settings → External Requests → EdgeConnect → New EdgeConnect</div>
                    </div>
                    <a href={`${TENANT_URL}/ui/apps/dynatrace.settings/settings/external-requests/?tab=edge-connect`} target="_blank" rel="noopener noreferrer" style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(65,105,225,0.3)', background: 'rgba(65,105,225,0.06)', fontSize: 11, fontWeight: 600, color: '#4169e1', textDecoration: 'none' }}>🔌 Open →</a>
                  </Flex>
                </div>

                {/* Step: Deploy EdgeConnect */}
                <div onClick={() => toggleCheck('edgeconnect-deploy')} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${checklist['edgeconnect-deploy'] ? 'rgba(0,180,0,0.3)' : Colors.Border.Neutral.Default}`, background: checklist['edgeconnect-deploy'] ? 'rgba(0,180,0,0.04)' : 'transparent', cursor: 'pointer', marginBottom: 8, transition: 'all 0.2s' }}>
                  <Flex alignItems="center" gap={12}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${isStepComplete('edgeconnect-deploy') ? '#2e7d32' : Colors.Border.Neutral.Default}`, background: isStepComplete('edgeconnect-deploy') ? '#2e7d32' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
                      {isStepComplete('edgeconnect-deploy') && <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <Strong style={{ fontSize: 13, textDecoration: isStepComplete('edgeconnect-deploy') ? 'line-through' : 'none', opacity: isStepComplete('edgeconnect-deploy') ? 0.6 : 1 }}>Deploy EdgeConnect on Server</Strong>
                      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>Enter credentials in Settings → EdgeConnect tab, copy YAML, run <code style={{ fontSize: 10, background: 'rgba(0,0,0,0.06)', padding: '1px 4px', borderRadius: 3 }}>./run-edgeconnect.sh</code> on server</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setSettingsTab('edgeconnect'); openSettingsModal(); setShowGetStartedModal(false); }} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${Colors.Theme.Primary['70']}`, background: 'rgba(108,44,156,0.08)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: Colors.Theme.Primary['70'] }}>⚙️ Setup</button>
                  </Flex>
                </div>

                {/* Step: Verify EdgeConnect Online */}
                <div onClick={() => toggleCheck('edgeconnect-online')} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${checklist['edgeconnect-online'] ? 'rgba(0,180,0,0.3)' : Colors.Border.Neutral.Default}`, background: checklist['edgeconnect-online'] ? 'rgba(0,180,0,0.04)' : 'transparent', cursor: 'pointer', marginBottom: 8, transition: 'all 0.2s' }}>
                  <Flex alignItems="center" gap={12}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${isStepComplete('edgeconnect-online') ? '#2e7d32' : Colors.Border.Neutral.Default}`, background: isStepComplete('edgeconnect-online') ? '#2e7d32' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
                      {isStepComplete('edgeconnect-online') && <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <Strong style={{ fontSize: 13, textDecoration: isStepComplete('edgeconnect-online') ? 'line-through' : 'none', opacity: isStepComplete('edgeconnect-online') ? 0.6 : 1 }}>Verify EdgeConnect is Online</Strong>
                      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>Settings → EdgeConnect tab → Check Connection — status should show ONLINE</div>
                    </div>
                  </Flex>
                </div>
              </div>

              {/* ── Section: Monitoring ── */}
              <div style={{ marginBottom: 20 }}>
                <Flex alignItems="center" gap={6} style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 14 }}>📡</span>
                  <Strong style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>Monitoring</Strong>
                </Flex>

                {/* Step: OneAgent */}
                <div onClick={() => toggleCheck('oneagent')} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${checklist['oneagent'] ? 'rgba(0,180,0,0.3)' : Colors.Border.Neutral.Default}`, background: checklist['oneagent'] ? 'rgba(0,180,0,0.04)' : 'transparent', cursor: 'pointer', marginBottom: 8, transition: 'all 0.2s' }}>
                  <Flex alignItems="center" gap={12}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${isStepComplete('oneagent') ? '#2e7d32' : Colors.Border.Neutral.Default}`, background: isStepComplete('oneagent') ? '#2e7d32' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
                      {isStepComplete('oneagent') && <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <Strong style={{ fontSize: 13, textDecoration: isStepComplete('oneagent') ? 'line-through' : 'none', opacity: isStepComplete('oneagent') ? 0.6 : 1 }}>OneAgent Installed on Host</Strong>
                      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>Ensure Dynatrace OneAgent is running on the BizObs server to monitor generated services</div>
                    </div>
                    <a href={`${TENANT_URL}/ui/apps/dynatrace.discovery.coverage/install/oneagent`} target="_blank" rel="noopener noreferrer" style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(65,105,225,0.3)', background: 'rgba(65,105,225,0.06)', fontSize: 11, fontWeight: 600, color: '#4169e1', textDecoration: 'none' }}>📥 Deploy →</a>
                  </Flex>
                </div>
              </div>

              {/* ── Section: Verify ── */}
              <div style={{ marginBottom: 20 }}>
                <Flex alignItems="center" gap={6} style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 14 }}>✅</span>
                  <Strong style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>Verify</Strong>
                </Flex>

                {/* Step: Test Connection */}
                <div onClick={() => toggleCheck('test-connection')} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${checklist['test-connection'] ? 'rgba(0,180,0,0.3)' : Colors.Border.Neutral.Default}`, background: checklist['test-connection'] ? 'rgba(0,180,0,0.04)' : 'transparent', cursor: 'pointer', marginBottom: 8, transition: 'all 0.2s' }}>
                  <Flex alignItems="center" gap={12}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${isStepComplete('test-connection') ? '#2e7d32' : Colors.Border.Neutral.Default}`, background: isStepComplete('test-connection') ? '#2e7d32' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
                      {isStepComplete('test-connection') && <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <Strong style={{ fontSize: 13, textDecoration: isStepComplete('test-connection') ? 'line-through' : 'none', opacity: isStepComplete('test-connection') ? 0.6 : 1 }}>Test Connection from App</Strong>
                      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>Settings → Config → click Test to verify the app can reach your server through EdgeConnect</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setSettingsTab('config'); openSettingsModal(); setShowGetStartedModal(false); }} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${Colors.Theme.Primary['70']}`, background: 'rgba(108,44,156,0.08)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: Colors.Theme.Primary['70'] }}>🔌 Test</button>
                  </Flex>
                </div>
              </div>

              {/* ── Section: Dynatrace Configuration (Coming Soon) ── */}
              <div style={{ marginBottom: 8 }}>
                <Flex alignItems="center" gap={6} style={{ marginBottom: 10 }}>
                  <span style={{ fontSize: 14 }}>⚙️</span>
                  <Strong style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>Dynatrace Configuration</Strong>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(181,137,0,0.15)', color: '#b58900', fontWeight: 700 }}>COMING NEXT</span>
                </Flex>

                {/* Step: OpenPipeline */}
                <div onClick={() => toggleCheck('openpipeline')} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${checklist['openpipeline'] ? 'rgba(0,180,0,0.3)' : Colors.Border.Neutral.Default}`, background: checklist['openpipeline'] ? 'rgba(0,180,0,0.04)' : 'transparent', cursor: 'pointer', marginBottom: 8, transition: 'all 0.2s' }}>
                  <Flex alignItems="center" gap={12}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${isStepComplete('openpipeline') ? '#2e7d32' : Colors.Border.Neutral.Default}`, background: isStepComplete('openpipeline') ? '#2e7d32' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
                      {isStepComplete('openpipeline') && <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <Strong style={{ fontSize: 13, textDecoration: isStepComplete('openpipeline') ? 'line-through' : 'none', opacity: isStepComplete('openpipeline') ? 0.6 : 1 }}>OpenPipeline Configuration</Strong>
                      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>Configure OpenPipeline to ingest and process business events from generated services</div>
                    </div>
                    <a href={`${TENANT_URL}/ui/apps/dynatrace.settings/settings/openpipeline-bizevents/pipelines?page=1&pageSize=50`} target="_blank" rel="noopener noreferrer" style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(65,105,225,0.3)', background: 'rgba(65,105,225,0.06)', fontSize: 11, fontWeight: 600, color: '#4169e1', textDecoration: 'none' }}>Open →</a>
                  </Flex>
                </div>

                {/* Step: Business Event Capture Rules */}
                <div onClick={() => toggleCheck('biz-events')} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${checklist['biz-events'] ? 'rgba(0,180,0,0.3)' : Colors.Border.Neutral.Default}`, background: checklist['biz-events'] ? 'rgba(0,180,0,0.04)' : 'transparent', cursor: 'pointer', marginBottom: 8, transition: 'all 0.2s' }}>
                  <Flex alignItems="center" gap={12}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${isStepComplete('biz-events') ? '#2e7d32' : Colors.Border.Neutral.Default}`, background: isStepComplete('biz-events') ? '#2e7d32' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
                      {isStepComplete('biz-events') && <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <Strong style={{ fontSize: 13, textDecoration: isStepComplete('biz-events') ? 'line-through' : 'none', opacity: isStepComplete('biz-events') ? 0.6 : 1 }}>Business Event Capture Rules</Strong>
                      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>Set up capture rules to extract business events from HTTP requests to generated services</div>
                    </div>
                    <a href={`${TENANT_URL}/ui/apps/dynatrace.settings/settings/bizevents/incoming`} target="_blank" rel="noopener noreferrer" style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(65,105,225,0.3)', background: 'rgba(65,105,225,0.06)', fontSize: 11, fontWeight: 600, color: '#4169e1', textDecoration: 'none' }}>Open →</a>
                  </Flex>
                </div>

                {/* Step: OneAgent Feature Flags */}
                <div onClick={() => toggleCheck('feature-flags')} style={{ padding: '12px 14px', borderRadius: 10, border: `1px solid ${checklist['feature-flags'] ? 'rgba(0,180,0,0.3)' : Colors.Border.Neutral.Default}`, background: checklist['feature-flags'] ? 'rgba(0,180,0,0.04)' : 'transparent', cursor: 'pointer', marginBottom: 8, transition: 'all 0.2s' }}>
                  <Flex alignItems="center" gap={12}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${isStepComplete('feature-flags') ? '#2e7d32' : Colors.Border.Neutral.Default}`, background: isStepComplete('feature-flags') ? '#2e7d32' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.2s' }}>
                      {isStepComplete('feature-flags') && <span style={{ color: 'white', fontSize: 14, fontWeight: 700 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <Strong style={{ fontSize: 13, textDecoration: isStepComplete('feature-flags') ? 'line-through' : 'none', opacity: isStepComplete('feature-flags') ? 0.6 : 1 }}>OneAgent Feature Flags</Strong>
                      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>Enable required feature flags for Node.js monitoring and business event capture</div>
                    </div>
                    <a href={`${TENANT_URL}/ui/apps/dynatrace.settings/settings/oneagent-features`} target="_blank" rel="noopener noreferrer" style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(65,105,225,0.3)', background: 'rgba(65,105,225,0.06)', fontSize: 11, fontWeight: 600, color: '#4169e1', textDecoration: 'none' }}>Open →</a>
                  </Flex>
                </div>
              </div>

              {/* Reset */}
              <Flex justifyContent="flex-end" style={{ marginTop: 8 }}>
                <button onClick={() => { setChecklist({}); localStorage.removeItem('bizobs_checklist'); }} style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${Colors.Border.Neutral.Default}`, background: 'transparent', cursor: 'pointer', fontSize: 11, fontWeight: 600, opacity: 0.5 }}>🔄 Reset checklist</button>
              </Flex>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Dialog (replaces native confirm()) ──── */}
      {confirmDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} onClick={() => setConfirmDialog(null)} />
          <div style={{ position: 'relative', width: 380, background: Colors.Background.Surface.Default, borderRadius: 14, border: `2px solid ${Colors.Theme.Primary['70']}`, boxShadow: '0 16px 40px rgba(0,0,0,0.3)' }}>
            <div style={{ padding: '16px 20px', background: 'linear-gradient(135deg, rgba(108,44,156,0.12), rgba(0,161,201,0.08))', borderRadius: '12px 12px 0 0', borderBottom: `1px solid ${Colors.Border.Neutral.Default}` }}>
              <Flex alignItems="center" gap={8}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <Strong style={{ fontSize: 15 }}>Confirm</Strong>
              </Flex>
            </div>
            <div style={{ padding: 20 }}>
              <Paragraph style={{ fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>{confirmDialog.message}</Paragraph>
              <Flex gap={8}>
                <Button onClick={() => setConfirmDialog(null)} style={{ flex: 1 }}>Cancel</Button>
                <Button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} style={{ flex: 1, background: 'rgba(220,50,47,0.15)', color: '#dc322f', fontWeight: 600 }}>Confirm</Button>
              </Flex>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast Notification ──── */}
      {toastVisible && (
        <div
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10003, minWidth: 320, maxWidth: 600,
            padding: '12px 20px', borderRadius: 10,
            display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            background: toastType === 'success' ? 'linear-gradient(135deg, rgba(115,190,40,0.95), rgba(80,160,20,0.95))'
              : toastType === 'error' ? 'linear-gradient(135deg, rgba(220,50,47,0.95), rgba(180,30,30,0.95))'
              : toastType === 'warning' ? 'linear-gradient(135deg, rgba(181,137,0,0.95), rgba(200,160,10,0.95))'
              : 'linear-gradient(135deg, rgba(0,161,201,0.95), rgba(0,130,170,0.95))',
            color: 'white', fontSize: 13, fontWeight: 500,
            animation: 'fadeInUp 0.3s ease',
          }}
        >
          <span style={{ fontSize: 16 }}>
            {toastType === 'success' ? '✅' : toastType === 'error' ? '❌' : toastType === 'warning' ? '⚠️' : 'ℹ️'}
          </span>
          <span style={{ flex: 1 }}>{toastMessage}</span>
          <button
            onClick={() => setToastVisible(false)}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}
          >
            ✕
          </button>
        </div>
      )}
    </Page>
  );
};
