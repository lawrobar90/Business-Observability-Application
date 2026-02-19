import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page } from '@dynatrace/strato-components-preview/layouts';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph, Strong } from '@dynatrace/strato-components/typography';
import { Button } from '@dynatrace/strato-components/buttons';
import { TextInput } from '@dynatrace/strato-components-preview/forms';
import { TitleBar } from '@dynatrace/strato-components-preview/layouts';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { appSettingsObjectsClient } from '@dynatrace-sdk/client-app-settings-v2';
import { functions } from '@dynatrace-sdk/app-utils';

const SCHEMA_ID = 'app:my.bizobs.generator:api-config';

// localStorage fallback key (for when app-settings is unavailable)
const LOCAL_STORAGE_KEY = 'bizobs_api_settings';

interface ApiSettings {
  apiHost: string;
  apiPort: string;
  apiProtocol: string;
  enableAutoGeneration: boolean;
}

const DEFAULT_SETTINGS: ApiSettings = {
  apiHost: 'localhost',
  apiPort: '8080',
  apiProtocol: 'http',
  enableAutoGeneration: false,
};

export const SettingsPage = () => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<ApiSettings>(DEFAULT_SETTINGS);
  const [objectId, setObjectId] = useState<string | null>(null);
  const [objectVersion, setObjectVersion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [useLocalStorage, setUseLocalStorage] = useState(false);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      // Try app-settings API first
      const result = await appSettingsObjectsClient.getEffectiveAppSettingsValues({
        schemaId: SCHEMA_ID,
        addFields: 'value',
      });

      if (result.items && result.items.length > 0) {
        const item = result.items[0];
        const value = item.value as any;
        setSettings({
          apiHost: value?.apiHost || DEFAULT_SETTINGS.apiHost,
          apiPort: value?.apiPort || DEFAULT_SETTINGS.apiPort,
          apiProtocol: value?.apiProtocol || DEFAULT_SETTINGS.apiProtocol,
          enableAutoGeneration: value?.enableAutoGeneration || DEFAULT_SETTINGS.enableAutoGeneration,
        });
        setStatusMessage('✅ Settings loaded from Dynatrace');
      } else {
        // No settings exist yet - try load from localStorage (migration)
        loadFromLocalStorage();
        setStatusMessage('ℹ️ No saved settings found. Using defaults.');
      }

      // Also get the objectId for updates
      try {
        const objects = await appSettingsObjectsClient.getAppSettingsObjects({
          schemaId: SCHEMA_ID,
          addFields: 'value,objectId,version',
        });
        if (objects.items && objects.items.length > 0) {
          setObjectId(objects.items[0].objectId);
          setObjectVersion(objects.items[0].version || null);
        }
      } catch (e) {
        // No objects yet, that's fine
      }
    } catch (error: any) {
      console.warn('App settings API not available, falling back to localStorage:', error.message);
      setUseLocalStorage(true);
      loadFromLocalStorage();
      setStatusMessage('⚠️ Using local storage (app settings schema not deployed yet)');
    }
    setIsLoading(false);
  };

  const loadFromLocalStorage = () => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSettings({
          apiHost: parsed.apiHost || DEFAULT_SETTINGS.apiHost,
          apiPort: parsed.apiPort || DEFAULT_SETTINGS.apiPort,
          apiProtocol: parsed.apiProtocol || DEFAULT_SETTINGS.apiProtocol,
          enableAutoGeneration: parsed.enableAutoGeneration || DEFAULT_SETTINGS.enableAutoGeneration,
        });
        // Also migrate legacy keys
      } else {
        // Check for legacy keys from the old inline config
        const legacyHost = localStorage.getItem('bizobs_api_host');
        const legacyPort = localStorage.getItem('bizobs_api_port');
        if (legacyHost || legacyPort) {
          setSettings(prev => ({
            ...prev,
            apiHost: legacyHost || prev.apiHost,
            apiPort: legacyPort || prev.apiPort,
          }));
        }
      }
    } catch (e) {
      console.error('Error loading from localStorage:', e);
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    setStatusMessage('💾 Saving...');

    // Always save to localStorage as backup
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
    // Also save legacy keys for backward compatibility
    localStorage.setItem('bizobs_api_host', settings.apiHost);
    localStorage.setItem('bizobs_api_port', settings.apiPort);

    if (!useLocalStorage) {
      try {
        if (objectId && objectVersion) {
          // Update existing
          await appSettingsObjectsClient.putAppSettingsObjectByObjectId({
            objectId,
            optimisticLockingVersion: objectVersion,
            body: { value: settings },
          });
        } else {
          // Create new
          await appSettingsObjectsClient.postAppSettingsObject({
            body: {
              schemaId: SCHEMA_ID,
              value: settings,
            },
          });
        }

        // Reload to get fresh objectId/version
        await loadSettings();
        setStatusMessage('✅ Settings saved to Dynatrace tenant!');
        // Navigate back to main page after short delay so user sees success
        setTimeout(() => navigate('/'), 800);
      } catch (error: any) {
        console.error('Failed to save to app settings:', error);
        setStatusMessage(`⚠️ Saved locally. Dynatrace save failed: ${error.message}`);
      }
    } else {
      setStatusMessage('✅ Settings saved locally!');
      setTimeout(() => navigate('/'), 800);
    }

    setIsSaving(false);
  };

  const testConnection = async () => {
    setIsTesting(true);
    setStatusMessage('🔄 Testing connection via server-side proxy...');

    try {
      const proxyResponse = await functions.call('proxy-api', {
        data: {
          action: 'test-connection',
          apiHost: settings.apiHost,
          apiPort: settings.apiPort,
          apiProtocol: settings.apiProtocol,
        },
      });

      const result = await proxyResponse.json() as any;

      if (result.success) {
        setStatusMessage(`✅ ${result.message}`);
      } else {
        setStatusMessage(`❌ ${result.error}${result.details ? '\n' + result.details : ''}`);
      }
    } catch (error: any) {
      setStatusMessage(`❌ Connection test failed: ${error.message}`);
    }
    setIsTesting(false);
  };

  const resetToDefaults = () => {
    setSettings(DEFAULT_SETTINGS);
    setStatusMessage('🔄 Reset to defaults. Click Save to persist.');
  };

  if (isLoading) {
    return (
      <Page>
        <Page.Header>
          <TitleBar>
            <TitleBar.Title>⚙️ Settings</TitleBar.Title>
            <TitleBar.Subtitle>Loading configuration...</TitleBar.Subtitle>
          </TitleBar>
        </Page.Header>
        <Page.Main>
          <Flex justifyContent="center" style={{ padding: 48 }}>
            <div style={{ fontSize: 48 }}>⏳</div>
          </Flex>
        </Page.Main>
      </Page>
    );
  }

  return (
    <Page>
      <Page.Header>
        <TitleBar>
          <TitleBar.Title>⚙️ Settings</TitleBar.Title>
          <TitleBar.Subtitle>Configure your BizObs Generator API connection</TitleBar.Subtitle>
        </TitleBar>
      </Page.Header>

      <Page.Main>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: 32 }}>
          {/* Status Banner */}
          {statusMessage && (
            <div style={{
              padding: 16,
              marginBottom: 24,
              borderRadius: 12,
              background: statusMessage.includes('✅')
                ? 'rgba(115, 190, 40, 0.12)'
                : statusMessage.includes('❌')
                ? 'rgba(220, 50, 47, 0.12)'
                : statusMessage.includes('⚠️')
                ? 'rgba(255, 210, 63, 0.12)'
                : 'rgba(0, 161, 201, 0.12)',
              border: `1px solid ${
                statusMessage.includes('✅')
                  ? Colors.Theme.Success['70']
                  : statusMessage.includes('❌')
                  ? '#dc322f'
                  : statusMessage.includes('⚠️')
                  ? 'rgba(255, 210, 63, 0.8)'
                  : Colors.Theme.Primary['70']
              }`,
              fontSize: 14,
              fontFamily: 'monospace',
            }}>
              {statusMessage}
            </div>
          )}

          {/* Storage Info Badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 14px',
            borderRadius: 20,
            background: useLocalStorage
              ? 'rgba(255, 210, 63, 0.15)'
              : 'rgba(115, 190, 40, 0.15)',
            border: `1px solid ${useLocalStorage ? 'rgba(255, 210, 63, 0.6)' : Colors.Theme.Success['70']}`,
            fontSize: 12,
            marginBottom: 24,
          }}>
            <span>{useLocalStorage ? '💾' : '☁️'}</span>
            <span>{useLocalStorage ? 'Local Storage' : 'Dynatrace App Settings'}</span>
          </div>

          {/* API Connection Settings Card */}
          <div style={{
            background: Colors.Background.Surface.Default,
            borderRadius: 16,
            border: `2px solid ${Colors.Border.Neutral.Default}`,
            overflow: 'hidden',
            marginBottom: 24,
          }}>
            <div style={{
              padding: '20px 24px',
              background: `linear-gradient(135deg, ${Colors.Theme.Primary['70']}, rgba(108, 44, 156, 0.9))`,
              color: 'white',
            }}>
              <Flex alignItems="center" gap={12}>
                <div style={{ fontSize: 28 }}>🔌</div>
                <div>
                  <Heading level={4} style={{ marginBottom: 0, color: 'white' }}>API Connection</Heading>
                  <Paragraph style={{ fontSize: 12, marginBottom: 0, color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>
                    Connect to your BizObs Generator Node.js service
                  </Paragraph>
                </div>
              </Flex>
            </div>

            <div style={{ padding: 24 }}>
              {/* Protocol */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  Protocol
                </label>
                <Flex gap={8}>
                  <Button
                    variant={settings.apiProtocol === 'http' ? 'emphasized' : 'default'}
                    onClick={() => setSettings(prev => ({ ...prev, apiProtocol: 'http' }))}
                    style={{ flex: 1 }}
                  >
                    HTTP
                  </Button>
                  <Button
                    variant={settings.apiProtocol === 'https' ? 'emphasized' : 'default'}
                    onClick={() => setSettings(prev => ({ ...prev, apiProtocol: 'https' }))}
                    style={{ flex: 1 }}
                  >
                    HTTPS
                  </Button>
                </Flex>
              </div>

              {/* Host */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  Host / IP Address
                </label>
                <TextInput
                  value={settings.apiHost}
                  onChange={(value: string) => setSettings(prev => ({ ...prev, apiHost: value }))}
                  placeholder="localhost or IP address"
                />
                <Paragraph style={{ fontSize: 11, marginTop: 6, marginBottom: 0, opacity: 0.7 }}>
                  e.g. <code style={{ background: 'rgba(0,0,0,0.1)', padding: '2px 6px', borderRadius: 4 }}>localhost</code>,{' '}
                  <code style={{ background: 'rgba(0,0,0,0.1)', padding: '2px 6px', borderRadius: 4 }}>3.209.41.33</code>,{' '}
                  <code style={{ background: 'rgba(0,0,0,0.1)', padding: '2px 6px', borderRadius: 4 }}>my-server.example.com</code>
                </Paragraph>
              </div>

              {/* Port */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  Port
                </label>
                <TextInput
                  value={settings.apiPort}
                  onChange={(value: string) => setSettings(prev => ({ ...prev, apiPort: value }))}
                  placeholder="8080"
                />
                <Paragraph style={{ fontSize: 11, marginTop: 6, marginBottom: 0, opacity: 0.7 }}>
                  Default BizObs Generator port is <strong>8080</strong>
                </Paragraph>
              </div>

              {/* Full URL Preview */}
              <div style={{
                padding: 16,
                background: 'rgba(0, 161, 201, 0.08)',
                border: `1px solid ${Colors.Theme.Primary['70']}`,
                borderRadius: 8,
                marginBottom: 20,
              }}>
                <Strong style={{ fontSize: 12, marginBottom: 6, display: 'block' }}>Full API URL:</Strong>
                <code style={{
                  display: 'block',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  padding: 8,
                  background: 'rgba(0,0,0,0.06)',
                  borderRadius: 4,
                }}>
                  {settings.apiProtocol}://{settings.apiHost}:{settings.apiPort}/api/journey-simulation/simulate-journey
                </code>
              </div>

              {/* Auto Generation Toggle */}
              <div style={{
                padding: 16,
                background: Colors.Background.Base.Default,
                borderRadius: 8,
                border: `1px solid ${Colors.Border.Neutral.Default}`,
              }}>
                <Flex alignItems="center" justifyContent="space-between">
                  <div>
                    <Strong style={{ fontSize: 13 }}>Auto Generate Services</Strong>
                    <Paragraph style={{ fontSize: 12, marginBottom: 0, marginTop: 2, opacity: 0.7 }}>
                      Automatically create services after validating JSON response
                    </Paragraph>
                  </div>
                  <Button
                    variant={settings.enableAutoGeneration ? 'emphasized' : 'default'}
                    onClick={() => setSettings(prev => ({
                      ...prev,
                      enableAutoGeneration: !prev.enableAutoGeneration,
                    }))}
                    style={{
                      minWidth: 80,
                      background: settings.enableAutoGeneration ? Colors.Theme.Success['70'] : undefined,
                    }}
                  >
                    {settings.enableAutoGeneration ? '✅ ON' : '❌ OFF'}
                  </Button>
                </Flex>
              </div>
            </div>
          </div>

          {/* Actions */}
          <Flex gap={12} style={{ marginBottom: 24 }}>
            <Button
              variant="emphasized"
              onClick={saveSettings}
              disabled={isSaving}
              style={{ flex: 2, padding: '14px', fontSize: 14, fontWeight: 600 }}
            >
              {isSaving ? '💾 Saving...' : '💾 Save Settings'}
            </Button>
            <Button
              onClick={testConnection}
              disabled={isTesting}
              style={{ flex: 1, padding: '14px', fontSize: 14 }}
            >
              {isTesting ? '🔄 Testing...' : '🔌 Test Connection'}
            </Button>
            <Button
              onClick={resetToDefaults}
              style={{ padding: '14px', fontSize: 14 }}
            >
              🔄 Reset
            </Button>
            <Button
              onClick={() => navigate('/')}
              style={{ padding: '14px', fontSize: 14 }}
            >
              ← Back
            </Button>
          </Flex>

          {/* How It Works Info */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(255, 210, 63, 0.12), rgba(255, 210, 63, 0.04))',
            borderRadius: 12,
            border: '1px solid rgba(255, 210, 63, 0.5)',
            padding: 24,
          }}>
            <Flex alignItems="flex-start" gap={12}>
              <div style={{ fontSize: 24 }}>💡</div>
              <div style={{ flex: 1 }}>
                <Strong style={{ fontSize: 14, marginBottom: 8, display: 'block' }}>How It Works</Strong>
                <Paragraph style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 12 }}>
                  These settings configure the connection between this Dynatrace app and your BizObs Generator Node.js service running on your host.
                </Paragraph>
                <Paragraph style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 12 }}>
                  <Strong>Step 1:</Strong> Ensure BizObs Generator is running on your target host<br />
                  <Strong>Step 2:</Strong> Enter the host, port, and protocol here<br />
                  <Strong>Step 3:</Strong> Click "Test Connection" to verify<br />
                  <Strong>Step 4:</Strong> Save — settings persist in the Dynatrace tenant
                </Paragraph>
                <Paragraph style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
                  When you click "🚀 Generate Services" on the main page, the app will call your BizObs Generator API at the configured URL to create live services.
                </Paragraph>
              </div>
            </Flex>
          </div>
        </div>
      </Page.Main>
    </Page>
  );
};
