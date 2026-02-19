import React, { useState, useEffect } from 'react';
import { Page } from '@dynatrace/strato-components-preview/layouts';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import { Button } from '@dynatrace/strato-components/buttons';
import { TextInput } from '@dynatrace/strato-components-preview/forms';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import { triggerFixItAgent, getFixItStatus } from '../services/bizobs-api';

interface Problem {
  eventId: string;
  displayId: string;
  title: string;
  status: string;
  startTime: string;
}

export const FixItAgent = () => {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [manualProblemId, setManualProblemId] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [fixItStatus, setFixItStatus] = useState<any>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      await Promise.all([fetchProblems(), fetchFixItStatus()]);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProblems = async () => {
    try {
      // Query Dynatrace for active problems using DQL
      const query = `
        fetch events
        | filter event.kind == "DAVIS_PROBLEM"
        | filter event.status == "ACTIVE"
        | fields event.id, display_id, event.name, event.status, event.start
        | sort event.start desc
        | limit 10
      `;

      const response = await queryExecutionClient.queryExecute({ body: { query } });
      const records = response?.result?.records || [];

      setProblems(
        records.map((record: any) => ({
          eventId: record['event.id'],
          displayId: record.display_id,
          title: record['event.name'],
          status: record['event.status'],
          startTime: record['event.start'],
        }))
      );
    } catch (err) {
      console.error('Failed to fetch problems:', err);
    }
  };

  const fetchFixItStatus = async () => {
    try {
      const status = await getFixItStatus();
      setFixItStatus(status);
    } catch (err) {
      console.error('Failed to fetch Fix-It status:', err);
    }
  };

  const handleTriggerFixIt = async (problemId: string) => {
    if (!problemId) {
      alert('Please provide a problem ID');
      return;
    }

    setTriggering(true);
    try {
      const result = await triggerFixItAgent(problemId);
      alert(`✅ Fix-It Agent triggered successfully!\nRun ID: ${result.runId || 'N/A'}`);
      await fetchFixItStatus();
    } catch (err) {
      alert(`❌ Failed to trigger Fix-It: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTriggering(false);
    }
  };

  if (loading) {
    return (
      <Page>
        <Flex flexDirection="column" alignItems="center" justifyContent="center" padding={32}>
          <ProgressCircle />
          <Text>Loading Fix-It Agent...</Text>
        </Flex>
      </Page>
    );
  }

  return (
    <Page>
      <Page.Header>
        <Heading level={1}>Fix-It AI Agent</Heading>
      </Page.Header>

      <Page.Main>
        {/* Fix-It Status */}
        <Surface style={{ marginBottom: 24, padding: 16 }}>
          <Heading level={3}>Agent Status</Heading>
          <Flex gap={16} marginTop={8}>
            <div>
              <Text style={{ color: 'gray' }}>Status</Text>
              <Text style={{ fontWeight: 'bold', color: fixItStatus?.active ? 'green' : 'gray' }}>
                {fixItStatus?.active ? '🟢 Active' : '⚪ Idle'}
              </Text>
            </div>
            <div>
              <Text style={{ color: 'gray' }}>Last Run</Text>
              <Text style={{ fontWeight: 'bold' }}>
                {fixItStatus?.lastRun || 'Never'}
              </Text>
            </div>
            <div>
              <Text style={{ color: 'gray' }}>Total Remediations</Text>
              <Text style={{ fontWeight: 'bold' }}>
                {fixItStatus?.totalRemediations || 0}
              </Text>
            </div>
          </Flex>
        </Surface>

        {/* Manual Trigger */}
        <Surface style={{ marginBottom: 24, padding: 16 }}>
          <Heading level={3}>Manual Trigger</Heading>
          <Text style={{ color: 'gray', marginBottom: 8 }}>
            Manually trigger Fix-It agent for a specific problem
          </Text>
          <Flex gap={8} alignItems="flex-end">
            <div style={{ flex: 1 }}>
              <Text style={{ fontWeight: 'bold', marginBottom: 4 }}>Problem ID</Text>
              <TextInput
                value={manualProblemId}
                onChange={(value) => setManualProblemId(value)}
                placeholder="e.g., P-2602106"
              />
            </div>
            <Button
              onClick={() => handleTriggerFixIt(manualProblemId)}
              variant="accent"
              disabled={triggering || !manualProblemId}
            >
              {triggering ? '⏳ Triggering...' : '🚀 Trigger Fix-It'}
            </Button>
          </Flex>
        </Surface>

        {/* Active Problems */}
        <Surface style={{ padding: 16 }}>
          <Heading level={3}>Active Problems</Heading>
          {problems.length === 0 ? (
            <Flex
              flexDirection="column"
              alignItems="center"
              justifyContent="center"
              padding={32}
            >
              <Text>No active problems found</Text>
              <Text style={{ color: 'gray', fontSize: 14 }}>
                Problems will appear here when detected by Davis AI
              </Text>
            </Flex>
          ) : (
            <Flex flexDirection="column" gap={8} marginTop={16}>
              {problems.map((problem) => (
                <Surface
                  key={problem.eventId}
                  style={{
                    padding: 16,
                    backgroundColor: '#fff3e0',
                    border: '1px solid #ff9800',
                  }}
                >
                  <Flex justifyContent="space-between" alignItems="center">
                    <div>
                      <Text style={{ fontWeight: 'bold' }}>{problem.title}</Text>
                      <Text style={{ fontSize: 12, color: 'gray' }}>
                        {problem.displayId} • {new Date(problem.startTime).toLocaleString()}
                      </Text>
                    </div>
                    <Button
                      onClick={() => handleTriggerFixIt(problem.displayId)}
                      variant="accent"
                      size="small"
                      disabled={triggering}
                    >
                      🔧 Fix It
                    </Button>
                  </Flex>
                </Surface>
              ))}
            </Flex>
          )}
        </Surface>
      </Page.Main>
    </Page>
  );
};
