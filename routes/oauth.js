/**
 * OAuth Authentication Routes for Dynatrace Sprint SSO
 */

import express from 'express';
import { AuthorizationCode } from 'simple-oauth2';
import crypto from 'crypto';

const router = express.Router();

// In-memory storage for OAuth state and tokens (in production, use Redis or database)
const oauthSessions = new Map();
const userTokens = new Map();

// OAuth configuration for Dynatrace Sprint
const oauth2Config = {
  client: {
    id: process.env.DT_OAUTH_CLIENT_ID || 'bizobs-generator',
    secret: process.env.DT_OAUTH_CLIENT_SECRET || ''
  },
  auth: {
    tokenHost: 'https://sso.dynatrace.com',
    tokenPath: '/sso/oauth2/token',
    authorizePath: '/sso/oauth2/authorize'
  },
  options: {
    authorizationMethod: 'body'
  }
};

/**
 * POST /api/oauth/init-flow
 * Initialize OAuth flow - returns authorization URL
 */
router.post('/init-flow', async (req, res) => {
  try {
    const { environment, redirectUri } = req.body;
    
    if (!environment) {
      return res.status(400).json({ error: 'Environment URL required' });
    }
    
    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    const sessionId = crypto.randomBytes(16).toString('hex');
    
    // Extract account UUID from environment URL
    // e.g., https://bko67471.sprint.apps.dynatracelabs.com → bko67471
    const accountMatch = environment.match(/https?:\/\/([^.]+)\./);
    const accountId = accountMatch ? accountMatch[1] : '';
    
    console.log('[OAuth] Initializing flow for environment:', environment);
    console.log('[OAuth] Account ID:', accountId);
    
    // Create OAuth client
    const client = new AuthorizationCode(oauth2Config);
    
    // Build authorization URL
    const authorizationUri = client.authorizeURL({
      redirect_uri: redirectUri || `${req.protocol}://${req.get('host')}/api/oauth/callback`,
      scope: 'storage:documents:write storage:documents:read',
      state: state,
      resource: `urn:dtaccount:${accountId}` // Sprint account resource
    });
    
    // Store session
    oauthSessions.set(state, {
      sessionId,
      environment,
      redirectUri,
      timestamp: Date.now()
    });
    
    console.log('[OAuth] Authorization URL generated');
    
    res.json({
      authUrl: authorizationUri,
      sessionId,
      state
    });
    
  } catch (error) {
    console.error('[OAuth] Init flow error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/oauth/callback
 * OAuth callback endpoint - exchanges code for token
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).send('Missing code or state');
    }
    
    // Verify state
    const session = oauthSessions.get(state);
    if (!session) {
      return res.status(400).send('Invalid or expired state');
    }
    
    console.log('[OAuth] Callback received, exchanging code for token');
    
    // Create OAuth client
    const client = new AuthorizationCode(oauth2Config);
    
    // Exchange code for access token
    const tokenParams = {
      code,
      redirect_uri: session.redirectUri || `${req.protocol}://${req.get('host')}/api/oauth/callback`,
      scope: 'storage:documents:write storage:documents:read'
    };
    
    const accessToken = await client.getToken(tokenParams);
    
    console.log('[OAuth] Token acquired successfully');
    
    // Store token
    userTokens.set(session.sessionId, {
      token: accessToken.token.access_token,
      refreshToken: accessToken.token.refresh_token,
      expiresAt: Date.now() + (accessToken.token.expires_in * 1000),
      environment: session.environment
    });
    
    // Clean up session
    oauthSessions.delete(state);
    
    // Redirect back to app with session ID
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentication Successful</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: #181A20;
            color: white;
          }
          .success {
            text-align: center;
            padding: 40px;
            background: #22242A;
            border-radius: 8px;
            border: 1px solid #2D2D2D;
          }
          .checkmark {
            font-size: 64px;
            color: #73BE28;
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <div class="success">
          <div class="checkmark">✓</div>
          <h1>Authentication Successful!</h1>
          <p>You can close this window and return to the app.</p>
        </div>
        <script>
          // Send message to parent window
          if (window.opener) {
            window.opener.postMessage({ 
              type: 'oauth-success', 
              sessionId: '${session.sessionId}' 
            }, window.location.origin);
            setTimeout(() => window.close(), 2000);
          }
        </script>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('[OAuth] Callback error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Authentication Failed</title></head>
      <body style="font-family: Arial; padding: 40px; background: #181A20; color: white;">
        <h1>❌ Authentication Failed</h1>
        <p>${error.message}</p>
        <button onclick="window.close()">Close Window</button>
      </body>
      </html>
    `);
  }
});

/**
 * POST /api/oauth/get-token
 * Retrieve token for a session
 */
router.post('/get-token', (req, res) => {
  const { sessionId } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }
  
  const tokenData = userTokens.get(sessionId);
  
  if (!tokenData) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }
  
  // Check if token is expired
  if (Date.now() >= tokenData.expiresAt) {
    userTokens.delete(sessionId);
    return res.status(401).json({ error: 'Token expired, please re-authenticate' });
  }
  
  res.json({
    token: tokenData.token,
    environment: tokenData.environment,
    expiresIn: Math.floor((tokenData.expiresAt - Date.now()) / 1000)
  });
});

/**
 * POST /api/oauth/revoke
 * Revoke/delete a session token
 */
router.post('/revoke', (req, res) => {
  const { sessionId } = req.body;
  
  if (sessionId && userTokens.has(sessionId)) {
    userTokens.delete(sessionId);
    res.json({ success: true, message: 'Token revoked' });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

export default router;
