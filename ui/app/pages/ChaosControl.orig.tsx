import React, { useState, useEffect } from 'react';
import { Page } from '@dynatrace/strato-components-preview/layouts';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import { Button } from '@dynatrace/strato-components/buttons';
import { SelectV2 } from '@dynatrace/strato-components-preview/forms';
import {
  getServiceStatus,
  getFeatureFlags,
  injectChaos,
  revertAllChaos,
  type ServiceStatus,
} from '../services/bizobs-api';

export const ChaosControl = () => {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedService, setSelectedService] = useState<string>('');
  const [chaosType, setChaosType] = useState<'enable_errors' | 'enable_latency'>('enable_errors');
  const [intensity, setIntensity] = useState(5);
  const [errorRate, setErrorRate] = useState<number>(0);
  const [injecting, setInjecting] = useState(false);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [servicesData, flagsData] = await Promise.all([
        getServiceStatus(),
        getFeatureFlags(),
      ]);
      setServices(servicesData.services);
      setErrorRate(flagsData.globalFeatureFlags.errors_per_transaction);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInjectChaos = async () => {
    if (!selectedService) {
      alert('Please select a service');
      return;
    }

    setInjecting(true);
    try {
      const result = await injectChaos({
        type: chaosType,
        target: selectedService,
        intensity: intensity,
        duration: 0, // Indefinite
      });
      alert(`✅ Chaos injected: ${result.chaosId}`);
      await loadData();
    } catch (err) {
      alert(`❌ Failed to inject chaos: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setInjecting(false);
    }
  };

  const handleRevertAll = async () => {
    if (!confirm('Revert all active chaos injections?')) {
      return;
    }

    try {
      const result = await revertAllChaos();
      alert(`✅ Reverted ${result.reverted} chaos injections`);
      await loadData();
    } catch (err) {
      alert(`❌ Failed to revert chaos: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  if (loading) {
    return (
      <Page>
        <Flex flexDirection="column" alignItems="center" justifyContent="center" padding={32}>
          <ProgressCircle />
          <Text>Loading chaos controls...</Text>
        </Flex>
      </Page>
    );
  }

  return (
    <Page>
      <Page.Header>
        <Heading level={1}>Chaos Engineering Control</Heading>
      </Page.Header>

      <Page.Main>
        {/* Current Status */}
        <Surface style={{ marginBottom: 24, padding: 16 }}>
          <Heading level={3}>Global Error Rate</Heading>
          <Heading level={2} style={{ color: errorRate > 0 ? 'orange' : 'green' }}>
            {(errorRate * 100).toFixed(1)}%
          </Heading>
          <Text style={{ color: 'gray' }}>
            {errorRate > 0
              ? '⚠️  Chaos active - services experiencing failures'
              : '✅ No global chaos - all services healthy'}
          </Text>
        </Surface>

        {/* Chaos Injection Form */}
        <Surface style={{ padding: 24 }}>
          <Heading level={3} style={{ marginBottom: 16 }}>
            Inject Chaos
          </Heading>

          <Flex flexDirection="column" gap={16}>
            {/* Service Selection */}
            <div>
              <Text style={{ fontWeight: 'bold', marginBottom: 8 }}>Target Service</Text>
              <SelectV2
                value={selectedService}
                onChange={(value) => setSelectedService(value as string)}
                placeholder="Select a service..."
              >
                {services.map((service) => (
                  <SelectV2.Option key={service.service} value={service.service}>
                    {service.service} ({service.companyContext.companyName})
                  </SelectV2.Option>
                ))}
              </SelectV2>
            </div>

            {/* Chaos Type */}
            <div>
              <Text style={{ fontWeight: 'bold', marginBottom: 8 }}>Chaos Type</Text>
              <SelectV2
                value={chaosType}
                onChange={(value) => setChaosType(value as 'enable_errors' | 'enable_latency')}
              >
                <SelectV2.Option value="enable_errors">
                  🔥 Enable Errors (HTTP 500s)
                </SelectV2.Option>
                <SelectV2.Option value="enable_latency">
                  ⏱️ Enable Latency (Slow responses)
                </SelectV2.Option>
              </SelectV2>
            </div>

            {/* Intensity */}
            <div>
              <Text style={{ fontWeight: 'bold', marginBottom: 8 }}>
                Intensity: {intensity}/10 ({intensity * 10}%)
              </Text>
              <Slider
                value={intensity}
                onChange={setIntensity}
                min={1}
                max={10}
                step={1}
              />
              <Text style={{ color: 'gray', fontSize: 12 }}>
                1 = 10% failure rate, 10 = 100% failure rate
              </Text>
            </div>

            {/* Action Buttons */}
            <Flex gap={8} marginTop={8}>
              <Button
                onClick={handleInjectChaos}
                variant="critical"
                disabled={injecting || !selectedService}
              >
                {injecting ? '⏳ Injecting...' : '💣 Inject Chaos'}
              </Button>
              <Button onClick={handleRevertAll} variant="accent">
                🔄 Revert All Chaos
              </Button>
            </Flex>
          </Flex>
        </Surface>

        {/* Active Services */}
        <Surface style={{ marginTop: 24, padding: 16 }}>
          <Heading level={4}>Running Services ({services.length})</Heading>
          <Flex flexWrap="wrap" gap={8} marginTop={8}>
            {services.map((service) => (
              <Surface
                key={service.service}
                style={{
                  padding: 8,
                  backgroundColor: service.service === selectedService ? '#e3f2fd' : '#f5f5f5',
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedService(service.service)}
              >
                <Text style={{ fontSize: 12 }}>
                  {service.stepName} ({service.companyContext.companyName})
                </Text>
              </Surface>
            ))}
          </Flex>
        </Surface>
      </Page.Main>
    </Page>
  );
};
