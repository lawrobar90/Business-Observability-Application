/**
 * MCP (Model Context Protocol) Integration for Dynatrace
 * Provides natural language interface to Dynatrace MCP Server
 */

import express from 'express';
import { spawn } from 'child_process';
import { AuthorizationCode } from 'simple-oauth2';
import crypto from 'crypto';
import open from 'open';

const router = express.Router();

// Store active MCP sessions
const mcpSessions = new Map();
const oauthStates = new Map();

/**
 * POST /api/mcp/init-session
 * Initialize MCP session with SSO authentication
 */
router.post('/init-session', async (req, res) => {
  try {
    const { environment } = req.body;
    
    if (!environment) {
      return res.status(400).json({ error: 'Environment URL required' });
    }
    
    console.log('[MCP] Initializing session for:', environment);
    
    // Extract account ID from environment URL
    const accountMatch = environment.match(/https?:\/\/([^.]+)\./);
    const accountId = accountMatch ? accountMatch[1] : '';
    
    // Generate state for OAuth
    const state = crypto.randomBytes(32).toString('hex');
    const sessionId = crypto.randomBytes(16).toString('hex');
    
    // OAuth configuration
    const oauth2Config = {
      client: {
        id: process.env.DT_OAUTH_CLIENT_ID || 'dt.mcp',
        secret: process.env.DT_OAUTH_CLIENT_SECRET || ''
      },
      auth: {
        tokenHost: 'https://sso.dynatrace.com',
        tokenPath: '/sso/oauth2/token',
        authorizePath: '/sso/oauth2/authorize'
      }
    };
    
    const client = new AuthorizationCode(oauth2Config);
    
    // Build authorization URL
    const authUrl = client.authorizeURL({
      redirect_uri: `${req.protocol}://${req.get('host')}/api/mcp/callback`,
      scope: 'storage:documents:write storage:documents:read storage:events:read storage:bizevents:read',
      state: state,
      response_type: 'code',
      resource: `urn:dtaccount:${accountId}`
    });
    
    // Store session
    oauthStates.set(state, {
      sessionId,
      environment,
      accountId,
      timestamp: Date.now()
    });
    
    console.log('[MCP] Session initialized:', sessionId);
    console.log('[MCP] Auth URL ready, waiting for user authentication...');
    
    res.json({
      sessionId,
      authUrl,
      message: 'Open the authentication URL in your browser'
    });
    
  } catch (error) {
    console.error('[MCP] Init session error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/mcp/callback
 * OAuth callback - exchanges code for token
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).send('Missing authorization code or state');
    }
    
    const session = oauthStates.get(state);
    if (!session) {
      return res.status(400).send('Invalid or expired authentication session');
    }
    
    console.log('[MCP] Callback received, exchanging code for token...');
    
    // OAuth configuration
    const oauth2Config = {
      client: {
        id: process.env.DT_OAUTH_CLIENT_ID || 'dt.mcp',
        secret: process.env.DT_OAUTH_CLIENT_SECRET || ''
      },
      auth: {
        tokenHost: 'https://sso.dynatrace.com',
        tokenPath: '/sso/oauth2/token',
        authorizePath: '/sso/oauth2/authorize'
      }
    };
    
    const client = new AuthorizationCode(oauth2Config);
    
    // Exchange code for token
    const tokenParams = {
      code,
      redirect_uri: `${req.protocol}://${req.get('host')}/api/mcp/callback`,
      scope: 'storage:documents:write storage:documents:read storage:events:read storage:bizevents:read'
    };
    
    const accessToken = await client.getToken(tokenParams);
    
    console.log('[MCP] ✅ Token acquired successfully');
    
    // Store MCP session with token
    mcpSessions.set(session.sessionId, {
      token: accessToken.token.access_token,
      refreshToken: accessToken.token.refresh_token,
      expiresAt: Date.now() + (accessToken.token.expires_in * 1000),
      environment: session.environment,
      accountId: session.accountId,
      authenticated: true
    });
    
    // Clean up OAuth state
    oauthStates.delete(state);
    
    // Success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>✅ MCP Authentication Successful</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .container {
            text-align: center;
            padding: 60px;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          }
          .checkmark {
            font-size: 80px;
            animation: pop 0.5s ease-out;
          }
          @keyframes pop {
            0% { transform: scale(0); }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); }
          }
          h1 { margin: 20px 0 10px; font-size: 32px; }
          p { font-size: 18px; opacity: 0.9; }
          .session-id {
            background: rgba(0, 0, 0, 0.2);
            padding: 10px 20px;
            border-radius: 8px;
            margin-top: 20px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="checkmark">✓</div>
          <h1>Authentication Successful!</h1>
          <p>MCP session is now active</p>
          <div class="session-id">Session: ${session.sessionId}</div>
          <p style="margin-top: 30px; font-size: 16px;">You can close this window and return to the app</p>
        </div>
        <script>
          // Notify parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'mcp-authenticated',
              sessionId: '${session.sessionId}'
            }, window.location.origin);
            setTimeout(() => window.close(), 3000);
          }
        </script>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('[MCP] Callback error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>❌ Authentication Failed</title></head>
      <body style="font-family: Arial; padding: 40px; background: #181A20; color: white; text-align: center;">
        <h1 style="color: #ff4444;">❌ Authentication Failed</h1>
        <p style="color: #ff8888;">${error.message}</p>
        <button onclick="window.close()" style="margin-top: 20px; padding: 10px 20px; background: #444; color: white; border: none; border-radius: 5px; cursor: pointer;">Close Window</button>
      </body>
      </html>
    `);
  }
});

/**
 * POST /api/mcp/chat
 * Send natural language message to MCP
 */
router.post('/chat', async (req, res) => {
  try {
    const { sessionId, message, context } = req.body;
    
    if (!sessionId || !message) {
      return res.status(400).json({ error: 'Session ID and message required' });
    }
    
    const session = mcpSessions.get(sessionId);
    if (!session || !session.authenticated) {
      return res.status(401).json({ error: 'Session not authenticated' });
    }
    
    console.log('[MCP Chat] User:', message);
    console.log('[MCP Chat] Context:', context?.journeyName || 'none');
    
    // Process message with journey context
    const response = await processMCPMessage(message, context, session);
    
    console.log('[MCP Chat] Response:', response.message.substring(0, 100) + '...');
    
    res.json(response);
    
  } catch (error) {
    console.error('[MCP] Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/mcp/auto-generate
 * Automatically generate notebook, dashboard, and BizEvents from journey data
 */
router.post('/auto-generate', async (req, res) => {
  try {
    const { sessionId, journeyData } = req.body;
    
    if (!journeyData) {
      return res.status(400).json({ success: false, error: 'Journey data required' });
    }
    
    // Get session if available, otherwise use defaults for testing
    const session = mcpSessions.get(sessionId) || {
      environment: process.env.DT_ENVIRONMENT || 'https://example.dynatrace.com',
      token: process.env.DT_TOKEN || 'mock-token',
      authenticated: false
    };
    
    console.log('[MCP Auto] Generating all artifacts for:', journeyData?.companyName);
    
    const results = {
      bizEvents: await generateBizEventConfig(journeyData),
      notebook: await generateNotebook(journeyData, session),
      dashboard: await generateDashboard(journeyData, session),
      serviceQueries: generateServiceQueries(journeyData)
    };
    
    res.json({
      success: true,
      message: `✅ Generated complete observability setup for ${journeyData.companyName}`,
      results
    });
    
  } catch (error) {
    console.error('[MCP Auto] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/mcp/query
 * Execute DQL query via natural language
 */
router.post('/query', async (req, res) => {
  try {
    const { sessionId, query, context } = req.body;
    
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query required' });
    }
    
    // Get session if available, otherwise use defaults
    const session = mcpSessions.get(sessionId) || {
      environment: process.env.DT_ENVIRONMENT || 'https://example.dynatrace.com',
      token: process.env.DT_TOKEN || 'mock-token',
      authenticated: false
    };
    
    console.log('[MCP Query] Natural language:', query);
    
    // Convert natural language to DQL
    const dql = naturalLanguageToDQL(query, context);
    console.log('[MCP Query] Generated DQL:', dql);
    
    // Try to execute query if authenticated, otherwise just return DQL
    let result = null;
    if (session.authenticated) {
      try {
        result = await executeDQLQuery(dql, session);
      } catch (error) {
        console.log('[MCP Query] Execution failed (no auth):', error.message);
      }
    }
    
    res.json({
      success: true,
      query: dql,
      result: result || { note: 'DQL generated - authenticate session to execute' }
    });
    
  } catch (error) {
    console.error('[MCP Query] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Process MCP message with journey context
 */
async function processMCPMessage(message, context, session) {
  // Analyze user intent
  const intent = analyzeIntent(message, context);
  
  switch (intent.type) {
    case 'configure_bizevents':
      return await configureBizEvents(context, session, intent);
      
    case 'create_dashboard':
      return await createDashboard(context, session, intent);
      
    case 'query_data':
      return await queryData(context, session, intent);
      
    case 'analyze_journey':
      return await analyzeJourney(context, session, intent);
      
    default:
      return {
        message: `I understand you want to: "${message}"\n\nFor your ${context?.journeyName || 'journey'}, I can help you:\n• Configure BizEvents for tracking\n• Create custom dashboards\n• Query existing data\n• Analyze journey performance\n\nWhat would you like to do?`,
        suggestions: [
          'Configure BizEvents for this journey',
          'Create a dashboard',
          'Show me the current journey data',
          'Analyze journey performance'
        ]
      };
  }
}

/**
 * Analyze user intent from natural language
 */
function analyzeIntent(message, context) {
  const lower = message.toLowerCase();
  
  if (lower.match(/bizevent|business event|configure|track|capture/)) {
    return { type: 'configure_bizevents', confidence: 0.9 };
  }
  
  if (lower.match(/dashboard|create|visualize|chart/)) {
    return { type: 'create_dashboard', confidence: 0.9 };
  }
  
  if (lower.match(/query|show|fetch|get|data|list|find/)) {
    return { type: 'query_data', confidence: 0.8 };
  }
  
  if (lower.match(/analyze|performance|metrics|stats/)) {
    return { type: 'analyze_journey', confidence: 0.85 };
  }
  
  if (lower.match(/notebook|generate|create notebook/)) {
    return { type: 'generate_notebook', confidence: 0.9 };
  }
  
  if (lower.match(/service|host|tag|deployment/)) {
    return { type: 'query_infrastructure', confidence: 0.85 };
  }
  
  return { type: 'general', confidence: 0.5 };
}

/**
 * Generate BizEvent configuration from journey data
 */
async function generateBizEventConfig(journeyData) {
  if (!journeyData || !journeyData.steps) {
    return null;
  }
  
  const eventType = `bizevents.${journeyData.companyName?.toLowerCase().replace(/\s+/g, '-')}.journey`;
  
  const config = {
    eventType,
    description: `Business events for ${journeyData.companyName} ${journeyData.journeyType}`,
    steps: journeyData.steps.map(step => {
      const attributes = {
        // Journey metadata
        'journey.id': '{{journey.id}}',
        'journey.type': journeyData.journeyType,
        'journey.step': step.stepName,
        'journey.step.index': step.stepIndex,
        'journey.category': step.category || step.stepCategory,
        
        // Company metadata
        'company.name': journeyData.companyName,
        'company.domain': journeyData.domain,
        'company.industry': journeyData.industryType,
        
        // Customer data
        'customer.id': '{{customer.id}}',
        'customer.segment': '{{customer.segment}}',
        
        // Technical metadata
        'service.name': step.serviceName || `${step.stepName}Service`,
        'timestamp': '{{timestamp}}'
      };
      
      // Add business metrics if available
      if (step.additionalFields) {
        if (step.additionalFields.transactionValue) {
          attributes['transaction.value'] = '{{transaction.value}}';
          attributes['transaction.currency'] = 'USD';
        }
        if (step.additionalFields.orderTotal) {
          attributes['order.total'] = '{{order.total}}';
        }
        if (step.additionalFields.customerLifetimeValue) {
          attributes['customer.lifetime_value'] = '{{customer.lifetime_value}}';
        }
        if (step.additionalFields.conversionProbability) {
          attributes['conversion.probability'] = '{{conversion.probability}}';
        }
      }
      
      return {
        stepName: step.stepName,
        eventName: `${eventType}.${step.stepName}Completed`,
        serviceName: step.serviceName,
        attributes
      };
    }),
    
    // DQL queries for this journey
    queries: {
      completions: `fetch bizevents, from: now() - 24h | filter event.type == "${eventType}" | summarize count = count(), by: {journey.step}`,
      revenue: `fetch bizevents, from: now() - 24h | filter event.type == "${eventType}" | summarize revenue = sum(transaction.value), by: {journey.step}`,
      funnel: `fetch bizevents, from: now() - 24h | filter event.type == "${eventType}" | fieldsAdd journey.step.index | summarize count = count(), by: {journey.step.index, journey.step} | sort journey.step.index asc`
    }
  };
  
  return config;
}

/**
 * Generate Jupyter notebook for journey analysis
 */
async function generateNotebook(journeyData, session) {
  if (!journeyData) return null;
  
  const notebook = {
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3"
      },
      language_info: {
        name: "python",
        version: "3.9.0"
      }
    },
    nbformat: 4,
    nbformat_minor: 4,
    cells: []
  };
  
  // Title cell
  notebook.cells.push({
    cell_type: "markdown",
    metadata: {},
    source: [
      `# ${journeyData.companyName} - ${journeyData.journeyType} Analysis\n`,
      `\n`,
      `**Industry:** ${journeyData.industryType}\n`,
      `**Domain:** ${journeyData.domain}\n`,
      `**Generated:** ${new Date().toISOString()}\n`,
      `\n`,
      `This notebook provides comprehensive analysis of the customer journey including:\n`,
      `- Journey completion metrics\n`,
      `- Revenue tracking by step\n`,
      `- Customer segment analysis\n`,
      `- Service performance metrics\n`
    ]
  });
  
  // Setup cell
  notebook.cells.push({
    cell_type: "markdown",
    metadata: {},
    source: ["## Setup and Import Libraries"]
  });
  
  notebook.cells.push({
    cell_type: "code",
    execution_count: null,
    metadata: {},
    outputs: [],
    source: [
      "import requests\n",
      "import pandas as pd\n",
      "import plotly.express as px\n",
      "import plotly.graph_objects as go\n",
      "from datetime import datetime, timedelta\n",
      "\n",
      "# Dynatrace configuration\n",
      `DT_ENVIRONMENT = "${session.environment}"\n`,
      `DT_TOKEN = "${session.token.substring(0, 10)}..."\n`,
      "\n",
      "headers = {\n",
      "    'Authorization': f'Bearer {DT_TOKEN}',\n",
      "    'Content-Type': 'application/json'\n",
      "}\n"
    ]
  });
  
  // Query function cell
  notebook.cells.push({
    cell_type: "markdown",
    metadata: {},
    source: ["## Helper Functions"]
  });
  
  notebook.cells.push({
    cell_type: "code",
    execution_count: null,
    metadata: {},
    outputs: [],
    source: [
      "def query_dynatrace(dql):\n",
      "    \"\"\"Execute DQL query against Dynatrace\"\"\"\n",
      "    url = f\"{DT_ENVIRONMENT}/platform/storage/query/v1/query:execute\"\n",
      "    payload = {\n",
      "        \"query\": dql,\n",
      "        \"defaultTimeframeStart\": \"now-24h\",\n",
      "        \"defaultTimeframeEnd\": \"now\"\n",
      "    }\n",
      "    response = requests.post(url, headers=headers, json=payload)\n",
      "    return response.json()\n",
      "\n",
      "def parse_results(result):\n",
      "    \"\"\"Convert DQL results to pandas DataFrame\"\"\"\n",
      "    if 'result' not in result or 'records' not in result['result']:\n",
      "        return pd.DataFrame()\n",
      "    return pd.DataFrame(result['result']['records'])\n"
    ]
  });
  
  // Journey overview cell
  notebook.cells.push({
    cell_type: "markdown",
    metadata: {},
    source: ["## Journey Overview"]
  });
  
  const eventType = `bizevents.${journeyData.companyName?.toLowerCase().replace(/\s+/g, '-')}.journey`;
  
  notebook.cells.push({
    cell_type: "code",
    execution_count: null,
    metadata: {},
    outputs: [],
    source: [
      `# Query journey completions by step\n`,
      `dql = """fetch bizevents, from: now() - 24h \n`,
      `| filter event.type == "${eventType}" \n`,
      `| summarize count = count(), by: {journey.step}\n`,
      `| sort count desc"""\n`,
      `\n`,
      `result = query_dynatrace(dql)\n`,
      `df_steps = parse_results(result)\n`,
      `\n`,
      `print(f"Total journey events: {df_steps['count'].sum()}")\n`,
      `df_steps`
    ]
  });
  
  // Funnel visualization
  notebook.cells.push({
    cell_type: "markdown",
    metadata: {},
    source: ["## Journey Funnel Visualization"]
  });
  
  notebook.cells.push({
    cell_type: "code",
    execution_count: null,
    metadata: {},
    outputs: [],
    source: [
      `# Create funnel chart\n`,
      `if not df_steps.empty:\n`,
      `    fig = go.Figure(go.Funnel(\n`,
      `        y = df_steps['journey.step'],\n`,
      `        x = df_steps['count'],\n`,
      `        textinfo = "value+percent initial"\n`,
      `    ))\n`,
      `    \n`,
      `    fig.update_layout(\n`,
      `        title="${journeyData.companyName} Journey Funnel",\n`,
      `        height=500\n`,
      `    )\n`,
      `    \n`,
      `    fig.show()\n`
    ]
  });
  
  // Revenue analysis cell
  notebook.cells.push({
    cell_type: "markdown",
    metadata: {},
    source: ["## Revenue Analysis by Step"]
  });
  
  notebook.cells.push({
    cell_type: "code",
    execution_count: null,
    metadata: {},
    outputs: [],
    source: [
      `# Query revenue by step\n`,
      `dql_revenue = """fetch bizevents, from: now() - 24h \n`,
      `| filter event.type == "${eventType}" \n`,
      `| summarize revenue = sum(transaction.value), count = count(), by: {journey.step}"""\n`,
      `\n`,
      `result_revenue = query_dynatrace(dql_revenue)\n`,
      `df_revenue = parse_results(result_revenue)\n`,
      `\n`,
      `if not df_revenue.empty:\n`,
      `    fig = px.bar(df_revenue, x='journey.step', y='revenue',\n`,
      `                 title='Revenue by Journey Step',\n`,
      `                 labels={'revenue': 'Revenue ($)', 'journey.step': 'Step'})\n`,
      `    fig.show()\n`,
      `else:\n`,
      `    print("No revenue data available")\n`
    ]
  });
  
  // Service performance
  notebook.cells.push({
    cell_type: "markdown",
    metadata: {},
    source: ["## Service Performance Metrics"]
  });
  
  notebook.cells.push({
    cell_type: "code",
    execution_count: null,
    metadata: {},
    outputs: [],
    source: [
      `# Query service performance\n`,
      `dql_services = """fetch dt.entity.service, from: now() - 1h\n`,
      `| filter tags contains "${journeyData.companyName?.toLowerCase()}"\n`,
      `| fields entity.name, service.request_count, service.failure_rate, service.response_time\n`,
      `| sort service.request_count desc\n`,
      `| limit 20"""\n`,
      `\n`,
      `result_services = query_dynatrace(dql_services)\n`,
      `df_services = parse_results(result_services)\n`,
      `df_services`
    ]
  });
  
  return {
    notebook,
    filename: `${journeyData.companyName.replace(/\s+/g, '_')}_Journey_Analysis.ipynb`,
    downloadable: true
  };
}

/**
 * Convert natural language to DQL
 */
function naturalLanguageToDQL(query, context) {
  const lower = query.toLowerCase();
  
  // List services tagged with X
  if (lower.match(/list.*services.*tagged|show.*services.*tag/)) {
    const tagMatch = query.match(/tagged.*["']([^"']+)["']|tagged.*as\s+(\S+)/i);
    const tag = tagMatch ? (tagMatch[1] || tagMatch[2]) : context?.companyName?.toLowerCase();
    
    return `fetch dt.entity.service, from: now() - 1h
| filter tags contains "${tag}"
| fields entity.name, tags, service.request_count, service.failure_rate
| sort service.request_count desc`;
  }
  
  // List hosts
  if (lower.match(/list.*hosts|show.*hosts/)) {
    return `fetch dt.entity.host, from: now() - 1h
| fields entity.name, host.cpu_usage, host.memory_usage, tags
| sort host.cpu_usage desc`;
  }
  
  // Journey completions
  if (lower.match(/journey.*completion|how many.*journey|count.*journey/)) {
    const eventType = context?.companyName 
      ? `bizevents.${context.companyName.toLowerCase().replace(/\s+/g, '-')}.journey`
      : 'bizevents';
    
    return `fetch bizevents, from: now() - 24h
| filter event.type == "${eventType}"
| summarize count = count(), by: {journey.step}
| sort count desc`;
  }
  
  // Revenue/business metrics
  if (lower.match(/revenue|money|value|business/)) {
    const eventType = context?.companyName 
      ? `bizevents.${context.companyName.toLowerCase().replace(/\s+/g, '-')}.journey`
      : 'bizevents';
    
    return `fetch bizevents, from: now() - 24h
| filter event.type == "${eventType}"
| summarize total_revenue = sum(transaction.value), avg_value = avg(transaction.value)`;
  }
  
  // Service errors
  if (lower.match(/error|failure|problem/)) {
    return `fetch dt.entity.service, from: now() - 1h
| filter service.failure_rate > 0
| fields entity.name, service.failure_rate, service.request_count
| sort service.failure_rate desc`;
  }
  
  // Default: general service query
  return `fetch dt.entity.service, from: now() - 1h
| fields entity.name, service.request_count, service.failure_rate, service.response_time, tags
| sort service.request_count desc
| limit 20`;
}

/**
 * Execute DQL query against Dynatrace
 */
async function executeDQLQuery(dql, session) {
  const fetch = (await import('node-fetch')).default;
  
  const url = `${session.environment}/platform/storage/query/v1/query:execute`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: dql,
      defaultTimeframeStart: 'now-24h',
      defaultTimeframeEnd: 'now',
      maxResultRecords: 100
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DQL query failed: ${response.status} - ${error}`);
  }
  
  return await response.json();
}

/**
 * Generate service queries for infrastructure
 */
function generateServiceQueries(journeyData) {
  const companyTag = journeyData.companyName?.toLowerCase().replace(/\s+/g, '-');
  
  return {
    allServices: `fetch dt.entity.service | filter tags contains "${companyTag}" | fields entity.name, service.request_count, service.failure_rate, tags`,
    
    errorServices: `fetch dt.entity.service | filter tags contains "${companyTag}" AND service.failure_rate > 0 | fields entity.name, service.failure_rate, service.request_count | sort service.failure_rate desc`,
    
    hostMetrics: `fetch dt.entity.host | filter tags contains "${companyTag}" | fields entity.name, host.cpu_usage, host.memory_usage, tags`,
    
    journeyServices: journeyData.steps?.map(step => ({
      stepName: step.stepName,
      serviceName: step.serviceName,
      query: `fetch dt.entity.service | filter entity.name == "${step.serviceName}" | fields entity.name, service.request_count, service.response_time, service.failure_rate`
    }))
  };
}

/**
 * Generate dashboard configuration
 */
async function generateDashboard(journeyData, session) {
  const dashboard = {
    dashboardMetadata: {
      name: `${journeyData.companyName} - Complete Observability Dashboard`,
      shared: true,
      owner: "mcp-auto-generated",
      tags: ["mcp", "auto-generated", journeyData.industryType, journeyData.companyName.toLowerCase().replace(/\s+/g, '-')]
    },
    tiles: []
  };
  
  // Tile 1: Journey Funnel
  dashboard.tiles.push({
    name: "Journey Completion Funnel",
    tileType: "DATA_EXPLORER",
    configured: true,
    bounds: { top: 0, left: 0, width: 608, height: 304 },
    queries: [{
      id: "A",
      metric: "bizevents",
      spaceAggregation: "AUTO",
      timeAggregation: "DEFAULT",
      splitBy: ["journey.step"],
      filterBy: {
        filter: `event.type == "bizevents.${journeyData.companyName.toLowerCase().replace(/\s+/g, '-')}.journey"`
      }
    }]
  });
  
  // Tile 2: Service Health
  dashboard.tiles.push({
    name: "Service Health Overview",
    tileType: "DATA_EXPLORER",
    configured: true,
    bounds: { top: 0, left: 608, width: 608, height: 304 },
    queries: [{
      id: "B",
      metric: "dt.entity.service",
      spaceAggregation: "AUTO",
      timeAggregation: "DEFAULT",
      splitBy: ["entity.name"],
      filterBy: {
        filter: `tags contains "${journeyData.companyName.toLowerCase()}"`
      }
    }]
  });
  
  // Tile 3: Revenue Tracking
  dashboard.tiles.push({
    name: "Revenue by Journey Step",
    tileType: "DATA_EXPLORER",
    configured: true,
    bounds: { top: 304, left: 0, width: 608, height: 304 },
    queries: [{
      id: "C",
      metric: "bizevents",
      spaceAggregation: "SUM",
      timeAggregation: "DEFAULT",
      splitBy: ["journey.step"],
      field: "transaction.value"
    }]
  });
  
  return {
    dashboard,
    deployUrl: `${session.environment}/api/v2/documents`
  };
}

/**
 * Configure BizEvents based on journey data
 */
async function configureBizEvents(context, session, intent) {
  console.log('[MCP] Configuring BizEvents for journey:', context?.journeyName);
  
  if (!context || !context.steps) {
    return {
      message: '❌ No journey context provided. Please run a journey simulation first.',
      suggestions: ['Run a journey simulation', 'Load existing journey']
    };
  }
  
  // Generate BizEvent configuration
  const bizEventConfig = {
    eventType: `bizevents.${context.companyName?.toLowerCase().replace(/\s+/g, '-')}.journey`,
    steps: context.steps.map(step => ({
      stepName: step.stepName,
      eventName: `${step.stepName}Completed`,
      attributes: {
        'journey.id': context.journeyId,
        'journey.type': context.journeyType,
        'journey.step': step.stepName,
        'journey.category': step.category,
        'company.name': context.companyName,
        'industry.type': context.industryType,
        ...extractBusinessMetrics(step)
      }
    }))
  };
  
  return {
    message: `✅ BizEvent configuration generated for **${context.companyName}** journey!\n\n**Event Type:** \`${bizEventConfig.eventType}\`\n\n**Configured Steps:**\n${bizEventConfig.steps.map(s => `• ${s.stepName} → \`${s.eventName}\``).join('\n')}\n\n**Business Attributes:**\n${Object.keys(bizEventConfig.steps[0].attributes).slice(0, 5).map(k => `• ${k}`).join('\n')}\n...and ${Object.keys(bizEventConfig.steps[0].attributes).length - 5} more\n\nWould you like me to:\n1. Deploy this configuration to Dynatrace\n2. Show detailed attribute mapping\n3. Test with sample data`,
    data: bizEventConfig,
    suggestions: [
      'Deploy BizEvent configuration',
      'Show detailed attributes',
      'Test with sample data'
    ]
  };
}

/**
 * Extract business metrics from journey step
 */
function extractBusinessMetrics(step) {
  const metrics = {};
  
  if (step.additionalFields) {
    // Extract revenue/financial metrics
    if (step.additionalFields.transactionValue) {
      metrics['transaction.value'] = step.additionalFields.transactionValue;
    }
    if (step.additionalFields.orderTotal) {
      metrics['order.total'] = step.additionalFields.orderTotal;
    }
    if (step.additionalFields.customerLifetimeValue) {
      metrics['customer.lifetime_value'] = step.additionalFields.customerLifetimeValue;
    }
    
    // Extract customer metrics
    if (step.additionalFields.customerSegment) {
      metrics['customer.segment'] = step.additionalFields.customerSegment;
    }
    if (step.additionalFields.conversionProbability) {
      metrics['conversion.probability'] = step.additionalFields.conversionProbability;
    }
  }
  
  return metrics;
}

/**
 * Create dashboard
 */
async function createDashboard(context, session, intent) {
  return {
    message: `I can create a custom dashboard for **${context?.companyName || 'your journey'}**.\n\nThe dashboard will include:\n• Journey completion funnel\n• Business metrics by step\n• Revenue tracking\n• Customer segment analysis\n• Performance metrics\n\nReady to deploy?`,
    suggestions: [
      'Yes, deploy the dashboard',
      'Customize dashboard tiles',
      'Preview dashboard layout'
    ]
  };
}

/**
 * Query data
 */
async function queryData(context, session, intent) {
  return {
    message: `I can query data for your journey. What would you like to know?\n\nAvailable queries:\n• Total journey completions\n• Revenue by step\n• Customer segments\n• Conversion rates\n• Performance metrics`,
    suggestions: [
      'Show total completions',
      'Revenue by journey step',
      'Customer segment breakdown',
      'Conversion funnel'
    ]
  };
}

/**
 * Analyze journey
 */
async function analyzeJourney(context, session, intent) {
  if (!context || !context.steps) {
    return {
      message: 'No journey data available for analysis. Please run a simulation first.',
      suggestions: ['Run journey simulation']
    };
  }
  
  const analysis = {
    totalSteps: context.steps.length,
    categories: [...new Set(context.steps.map(s => s.category))],
    estimatedDuration: context.steps.reduce((sum, s) => sum + (s.estimatedDuration || 0), 0),
    businessValue: 'high' // Simplified
  };
  
  return {
    message: `📊 **Journey Analysis: ${context.companyName}**\n\n**Overview:**\n• ${analysis.totalSteps} steps\n• ${analysis.categories.join(', ')} phases\n• ~${analysis.estimatedDuration} minutes total duration\n\n**Key Steps:**\n${context.steps.slice(0, 3).map((s, i) => `${i + 1}. ${s.stepName} (${s.category})`).join('\n')}\n\n**Business Impact:**\n• Customer segment: ${context.additionalFields?.customerSegment || 'standard'}\n• Conversion probability: ${context.additionalFields?.conversionProbability || 0.6}\n• Estimated value: $${context.additionalFields?.customerLifetimeValue || 'N/A'}\n\nWhat would you like to optimize?`,
    data: analysis,
    suggestions: [
      'Show bottlenecks',
      'Revenue optimization opportunities',
      'Configure tracking for all steps'
    ]
  };
}

/**
 * GET /api/mcp/session-status
 * Check session authentication status
 */
router.get('/session-status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = mcpSessions.get(sessionId);
  
  if (!session) {
    return res.json({ authenticated: false, message: 'Session not found' });
  }
  
  // Check token expiration
  if (Date.now() >= session.expiresAt) {
    mcpSessions.delete(sessionId);
    return res.json({ authenticated: false, message: 'Token expired' });
  }
  
  res.json({
    authenticated: session.authenticated,
    environment: session.environment,
    expiresIn: Math.floor((session.expiresAt - Date.now()) / 1000)
  });
});

export default router;
