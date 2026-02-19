import React, { useState, useEffect } from 'react';
import { Page } from '@dynatrace/strato-components-preview/layouts';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph, Strong } from '@dynatrace/strato-components/typography';
import { Button } from '@dynatrace/strato-components/buttons';
import { TitleBar } from '@dynatrace/strato-components-preview/layouts';
import Colors from '@dynatrace/strato-design-tokens/colors';

const API_BASE = 'http://3.209.41.33:8080/api';

interface Service {
  company: string;
  service: string;
  status: string;
  port?: number;
  baseUrl?: string;
  pid?: number;
  startTime?: string;
  uptime?: string;
}

export const ServiceDashboard = () => {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [selectedTab, setSelectedTab] = useState<'all' | 'running' | 'stopped'>('all');

  useEffect(() => {
    loadServices();
    const interval = setInterval(() => {
      loadServices();
      setLastUpdate(new Date());
    }, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const loadServices = async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/services/status`);
      const data = await response.json();
      setServices(data.services || []);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load services:', error);
      setLoading(false);
    }
  };

  const stopService = async (company: string, service: string) => {
    try {
      await fetch(`${API_BASE}/admin/services/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, service })
      });
      await loadServices();
    } catch (error) {
      console.error('Failed to stop service:', error);
    }
  };

  const startService = async (company: string, service: string) => {
    try {
      await fetch(`${API_BASE}/admin/ensure-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, service })
      });
      await loadServices();
    } catch (error) {
      console.error('Failed to start service:', error);
    }
  };

  const stopAllServices = async () => {
    if (!confirm('Stop all running services?')) return;
    try {
      await fetch(`${API_BASE}/admin/services/stop-all`, { method: 'POST' });
      await loadServices();
    } catch (error) {
      console.error('Failed to stop all services:', error);
    }
  };

  const filteredServices = services.filter(s => {
    if (selectedTab === 'running') return s.status === 'running';
    if (selectedTab === 'stopped') return s.status !== 'running';
    return true;
  });

  const runningCount = services.filter(s => s.status === 'running').length;
  const stoppedCount = services.length - runningCount;

  const groupedServices = filteredServices.reduce((acc, service) => {
    if (!acc[service.company]) acc[service.company] = [];
    acc[service.company].push(service);
    return acc;
  }, {} as Record<string, Service[]>);

  return (
    <Page>
      <Page.Header>
        <TitleBar>
          <TitleBar.Title>Service Dashboard</TitleBar.Title>
          <TitleBar.Subtitle>
            Real-time service monitoring and management · Last update: {lastUpdate.toLocaleTimeString()}
          </TitleBar.Subtitle>
        </TitleBar>
      </Page.Header>

      <Page.Main>
        <div style={{ padding: 24 }}>
          {/* Stats Bar */}
          <Flex gap={16} style={{ marginBottom: 24 }}>
            <div style={{ 
              flex: 1,
              padding: 20,
              background: Colors.Background.Surface.Default,
              borderRadius: 8,
              border: `2px solid ${Colors.Charts.Categorical.Color02.Default}`
            }}>
              <Heading level={1} style={{ color: Colors.Charts.Categorical.Color02.Default, marginBottom: 8 }}>
                {runningCount}
              </Heading>
              <Paragraph>Running Services</Paragraph>
            </div>

            <div style={{ 
              flex: 1,
              padding: 20,
              background: Colors.Background.Surface.Default,
              borderRadius: 8,
              border: `2px solid ${Colors.Border.Neutral.Default}`
            }}>
              <Heading level={1} style={{ opacity: 0.5, marginBottom: 8 }}>
                {stoppedCount}
              </Heading>
              <Paragraph>Stopped Services</Paragraph>
            </div>

            <div style={{ 
              flex: 1,
              padding: 20,
              background: Colors.Background.Surface.Default,
              borderRadius: 8,
              border: `2px solid ${Colors.Theme.Primary['70']}`
            }}>
              <Heading level={1} style={{ color: Colors.Theme.Primary['70'], marginBottom: 8 }}>
                {services.length}
              </Heading>
              <Paragraph>Total Services</Paragraph>
            </div>
          </Flex>

          {/* Action Bar */}
          <Flex gap={12} justifyContent="space-between" alignItems="center" style={{ marginBottom: 24 }}>
            <Flex gap={8}>
              <Button 
                variant={selectedTab === 'all' ? 'emphasized' : 'default'}
                onClick={() => setSelectedTab('all')}
              >
                All ({services.length})
              </Button>
              <Button 
                variant={selectedTab === 'running' ? 'emphasized' : 'default'}
                onClick={() => setSelectedTab('running')}
                style={{ color: selectedTab === 'running' ? Colors.Charts.Categorical.Color02.Default : undefined }}
              >
                🟢 Running ({runningCount})
              </Button>
              <Button 
                variant={selectedTab === 'stopped' ? 'emphasized' : 'default'}
                onClick={() => setSelectedTab('stopped')}
              >
                ⚫ Stopped ({stoppedCount})
              </Button>
            </Flex>

            <Flex gap={8}>
              <Button onClick={loadServices}>
                🔄 Refresh
              </Button>
              {runningCount > 0 && (
                <Button color="critical" onClick={stopAllServices}>
                  ⏹️ Stop All
                </Button>
              )}
            </Flex>
          </Flex>

          {/* Services List */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Paragraph>Loading services...</Paragraph>
            </div>
          ) : filteredServices.length === 0 ? (
            <div style={{ 
              padding: 40,
              textAlign: 'center',
              background: Colors.Background.Surface.Default,
              borderRadius: 8
            }}>
              <Heading level={3} style={{ marginBottom: 16 }}>No services {selectedTab !== 'all' ? selectedTab : 'available'}</Heading>
              <Paragraph>Start services from the home page or using the API</Paragraph>
            </div>
          ) : (
            <div>
              {Object.entries(groupedServices).map(([company, companyServices]) => (
                <div key={company} style={{ marginBottom: 32 }}>
                  <Heading level={3} style={{ 
                    marginBottom: 16,
                    paddingBottom: 8,
                    borderBottom: `2px solid ${Colors.Border.Neutral.Default}`
                  }}>
                    🏢 {company}
                  </Heading>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 16 }}>
                    {companyServices.map((service) => (
                      <div
                        key={`${service.company}-${service.service}`}
                        style={{
                          padding: 20,
                          background: Colors.Background.Surface.Default,
                          borderRadius: 8,
                          border: `2px solid ${service.status === 'running' ? Colors.Charts.Categorical.Color02.Default : Colors.Border.Neutral.Default}`,
                          position: 'relative'
                        }}
                      >
                        <Flex justifyContent="space-between" alignItems="flex-start" style={{ marginBottom: 12 }}>
                          <div>
                            <Heading level={4} style={{ marginBottom: 4 }}>
                              {service.status === 'running' ? '🟢' : '⚫'} {service.service}
                            </Heading>
                            <Paragraph style={{ fontSize: 12, opacity: 0.7 }}>
                              Status: <Strong>
                                {service.status}
                              </Strong>
                            </Paragraph>
                          </div>
                          {service.status === 'running' ? (
                            <Button 
                            variant="default"
                              onClick={() => stopService(service.company, service.service)}
                              style={{ padding: '4px 8px' }}
                            >
                              ⏹️ Stop
                            </Button>
                          ) : (
                            <Button 
                              variant="default"
                              onClick={() => startService(service.company, service.service)}
                              style={{ padding: '4px 8px' }}
                            >
                              ▶️ Start
                            </Button>
                          )}
                        </Flex>

                        {service.port && (
                          <div style={{ fontSize: 12, marginTop: 8 }}>
                            <Paragraph style={{ fontSize: 12 }}>
                              Port: <Strong>{service.port}</Strong>
                            </Paragraph>
                            {service.baseUrl && (
                              <Paragraph style={{ fontSize: 12, wordBreak: 'break-all' }}>
                                URL: <a href={service.baseUrl} target="_blank" rel="noopener noreferrer" style={{ color: Colors.Theme.Primary['70'] }}>
                                  {service.baseUrl}
                                </a>
                              </Paragraph>
                            )}
                          </div>
                        )}

                        {service.uptime && (
                          <Paragraph style={{ fontSize: 11, marginTop: 8, opacity: 0.6 }}>
                            Uptime: {service.uptime}
                          </Paragraph>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Page.Main>
    </Page>
  );
};
