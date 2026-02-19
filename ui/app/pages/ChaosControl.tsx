import React, { useState, useEffect } from 'react';
import { Page } from '@dynatrace/strato-components-preview/layouts';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph, Strong } from '@dynatrace/strato-components/typography';
import { Button } from '@dynatrace/strato-components/buttons';
import { TitleBar } from '@dynatrace/strato-components-preview/layouts';
import { SelectV2 } from '@dynatrace/strato-components-preview/forms';
import Colors from '@dynatrace/strato-design-tokens/colors';

const API_BASE = 'http://3.209.41.33:8080/api';

interface Service {
  company: string;
  service: string;
  status: string;
}

interface ChaosConfig {
  service?: string;
  errorRate?: number;
  latency?: { enabled: boolean; min: number; max: number };
  timeout?: { enabled: boolean; duration: number };
}

export const ChaosControl = () => {
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState('all');
  const [errorRate, setErrorRate] = useState(50);
  const [chaosActive, setChaosActive] = useState(false);
  const [globalErrorRate, setGlobalErrorRate] = useState(0);
  const [activeFaults, setActiveFaults] = useState<any[]>([]);

  useEffect(() => {
    loadServices();
    loadChaosStatus();
    const interval = setInterval(() => {
      loadServices();
      loadChaosStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadServices = async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/services/status`);
      const data = await response.json();
      setServices(data.services?.filter((s: Service) => s.status === 'running') || []);
    } catch (error) {
      console.error('Failed to load services:', error);
    }
  };

  const loadChaosStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/gremlin/status`);
      const data = await response.json();
      setGlobalErrorRate(data.globalErrorRate || 0);
      setActiveFaults(data.activeFaults || []);
      setChaosActive((data.activeFaults?.length || 0) > 0);
    } catch (error) {
      console.error('Failed to load chaos status:', error);
    }
  };

  const injectChaos = async () => {
    try {
      const config: ChaosConfig = {
        errorRate: errorRate
      };
      
      if (selectedService !== 'all') {
        config.service = selectedService;
      }

      const response = await fetch(`${API_BASE}/gremlin/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      if (response.ok) {
        await loadChaosStatus();
      }
    } catch (error) {
      console.error('Failed to inject chaos:', error);
    }
  };

  const revertChaos = async (service?: string) => {
    try {
      const endpoint = service ? `${API_BASE}/gremlin/revert/${service}` : `${API_BASE}/gremlin/revert-all`;
      await fetch(endpoint, { method: 'POST' });
      await loadChaosStatus();
    } catch (error) {
      console.error('Failed to revert chaos:', error);
    }
  };

  return (
    <Page>
      <Page.Header>
        <TitleBar>
          <TitleBar.Title>👹 Chaos Control - Gremlin Agent</TitleBar.Title>
          <TitleBar.Subtitle>Inject controlled chaos into your services for testing resilience</TitleBar.Subtitle>
        </TitleBar>
      </Page.Header>

      <Page.Main>
        <div style={{ padding: 24 }}>
          {/* Status Banner */}
          <div style={{ 
            padding: 20,
            marginBottom: 24,
            background: chaosActive ? 'rgba(255, 82, 82, 0.2)' : 'rgba(115, 190, 40, 0.2)',
            borderRadius: 8,
            border: `2px solid ${chaosActive ? '#ff5252' : Colors.Charts.Categorical.Color02.Default}`
          }}>
            <Flex justifyContent="space-between" alignItems="center">
              <div>
                <Heading level={2} style={{ marginBottom: 8 }}>
                  {chaosActive ? '⚠️ Chaos Active' : '✅ System Healthy'}
                </Heading>
                <Paragraph>
                  Global Error Rate: <Strong style={{ fontSize: 24 }}>
                    {(globalErrorRate * 100).toFixed(1)}%
                  </Strong>
                </Paragraph>
                <Paragraph style={{ fontSize: 12, opacity: 0.7 }}>
                  {chaosActive ? `${activeFaults.length} active fault(s) injected` : 'No chaos currently active'}
                </Paragraph>
              </div>
              {chaosActive && (
                <Button color="critical" onClick={() => revertChaos()}>
                  ⏹️ Revert All Chaos
                </Button>
              )}
            </Flex>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Left Column: Chaos Injection */}
            <div style={{ 
              padding: 24,
                background: Colors.Background.Surface.Default,
              borderRadius: 8,
              border: `2px solid #ff5252`
            }}>
              <Heading level={3} style={{ marginBottom: 20, color: '#ff5252' }}>
                👹 Inject Chaos
              </Heading>

              <Flex flexDirection="column" gap={20}>
                <div>
                  <Paragraph style={{ marginBottom: 8, fontWeight: 600 }}>
                    🎯 Target Service
                  </Paragraph>
                  <SelectV2
                    value={selectedService}
                    onChange={(value) => setSelectedService(value as string)}
                  >
                    <SelectV2.Option value="all">All Services (Global)</SelectV2.Option>
                    {services.map((service) => (
                      <SelectV2.Option key={`${service.company}-${service.service}`} value={service.service}>
                        {service.service} ({service.company})
                      </SelectV2.Option>
                    ))}
                  </SelectV2>
                </div>

                <div>
                  <Paragraph style={{ marginBottom: 8, fontWeight: 600 }}>
                    💥 Error Rate: {errorRate}%
                  </Paragraph>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="10"
                    value={errorRate}
                    onChange={(e) => setErrorRate(parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      height: 8,
                      borderRadius: 4,
                      background: `linear-gradient(to right, ${Colors.Charts.Categorical.Color02.Default} 0%, #ff5252 ${errorRate}%, ${Colors.Background.Base.Default} ${errorRate}%)`,
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  />
                  <Flex justifyContent="space-between" style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>
                    <span>Low (10%)</span>
                    <span>Medium (50%)</span>
                    <span>High (100%)</span>
                  </Flex>
                </div>

                <Paragraph style={{ fontSize: 12, padding: 12, background: 'rgba(255, 82, 82, 0.1)', borderRadius: 4 }}>
                  ⚠️ <Strong>Warning:</Strong> This will cause {errorRate}% of requests to {selectedService === 'all' ? 'all services' : selectedService} to fail with errors.
                </Paragraph>

                <Button 
                  color="critical"
                  onClick={injectChaos}
                  style={{ padding: '16px 24px', fontSize: 16, fontWeight: 'bold' }}
                >
                  👹 Inject Chaos
                </Button>

                <div style={{ 
                  marginTop: 20,
                  paddingTop: 20,
                  borderTop: `1px solid ${Colors.Border.Neutral.Default}`
                }}>
                  <Heading level={4} style={{ marginBottom: 12 }}>🧠 Quick Recipes</Heading>
                  <Flex flexDirection="column" gap={8}>
                    <Button 
                      variant="default"
                      onClick={() => { setSelectedService('all'); setErrorRate(20); }}
                      style={{ justifyContent: 'flex-start', padding: '8px 12px' }}
                    >
                      💤 Network Flakiness (20% global)
                    </Button>
                    <Button 
                      variant="default"
                      onClick={() => { setErrorRate(80); }}
                      style={{ justifyContent: 'flex-start', padding: '8px 12px' }}
                    >
                      💥 Service Outage (80% errors)
                    </Button>
                    <Button 
                      variant="default"
                      onClick={() => { setErrorRate(50); }}
                      style={{ justifyContent: 'flex-start', padding: '8px 12px' }}
                    >
                      📊 Load Testing Scenario (50%)
                    </Button>
                  </Flex>
                </div>
              </Flex>
            </div>

            {/* Right Column: Active Faults */}
            <div style={{ 
              padding: 24,
              background: Colors.Background.Surface.Default,
              borderRadius: 8
            }}>
              <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: 20 }}>
                <Heading level={3}>⚡ Active Faults</Heading>
                <Button variant="default" onClick={loadChaosStatus}>
                  🔄 Refresh
                </Button>
              </Flex>

              {activeFaults.length === 0 ? (
                <div style={{ 
                  padding: 40,
                  textAlign: 'center',
                  background: 'rgba(115, 190, 40, 0.1)',
                  borderRadius: 8
                }}>
                  <Paragraph style={{ fontSize: 40, marginBottom: 16 }}>✅</Paragraph>
                  <Heading level={4} style={{ marginBottom: 8 }}>No Active Faults</Heading>
                  <Paragraph style={{ fontSize: 14, opacity: 0.7 }}>
                    All services are running normally
                  </Paragraph>
                </div>
              ) : (
                <Flex flexDirection="column" gap={12}>
                  {activeFaults.map((fault, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: 16,
                        background: 'rgba(255, 82, 82, 0.1)',
                        borderRadius: 8,
                        border: '1px solid rgba(255, 82, 82, 0.3)'
                      }}
                    >
                      <Flex justifyContent="space-between" alignItems="flex-start">
                        <div style={{ flex: 1 }}>
                          <Heading level={4} style={{ marginBottom: 4, color: '#ff5252' }}>
                            {fault.service || 'Global'}
                          </Heading>
                          <Paragraph style={{ fontSize: 12, marginBottom: 8 }}>
                            Error Rate: <Strong>{(fault.errorRate * 100).toFixed(0)}%</Strong>
                          </Paragraph>
                          {fault.since && (
                            <Paragraph style={{ fontSize: 11, opacity: 0.6 }}>
                              Active since: {new Date(fault.since).toLocaleTimeString()}
                            </Paragraph>
                          )}
                        </div>
                        <Button 
                          variant="default"
                          onClick={() => revertChaos(fault.service)}
                          style={{ padding: '4px 8px' }}
                        >
                          ⏹️ Revert
                        </Button>
                      </Flex>
                    </div>
                  ))}
                </Flex>
              )}

              {/* Info Section */}
              <div style={{ 
                marginTop: 24,
                padding: 16,
                background: 'rgba(0, 161, 201, 0.1)',
                borderRadius: 8
              }}>
                <Heading level={4} style={{ marginBottom: 8 }}>ℹ️ About Chaos Engineering</Heading>
                <Paragraph style={{ fontSize: 12, lineHeight: 1.6 }}>
                  Chaos engineering tests system resilience by intentionally injecting faults. 
                  Monitor your Dynatrace dashboard to see how the system responds to failures 
                  and verify your error handling and recovery mechanisms.
                </Paragraph>
              </div>
            </div>
          </div>
        </div>
      </Page.Main>
    </Page>
  );
};
