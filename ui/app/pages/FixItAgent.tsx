import React, { useState, useEffect } from 'react';
import { Page } from '@dynatrace/strato-components-preview/layouts';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph, Strong } from '@dynatrace/strato-components/typography';
import { Button } from '@dynatrace/strato-components/buttons';
import { TitleBar } from '@dynatrace/strato-components-preview/layouts';
import { TextInput } from '@dynatrace/strato-components-preview/forms';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

const API_BASE = 'http://3.209.41.33:8080/api';

interface Problem {
  problemId: string;
  displayId: string;
  title: string;
  status: string;
  severityLevel: string;
  startTime: number;
  affectedEntities?: string[];
}

export const FixItAgent = () => {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualProblemId, setManualProblemId] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [fixItLog, setFixItLog] = useState<string[]>([]);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  useEffect(() => {
    loadActiveProblems();
    const interval = setInterval(loadActiveProblems, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const loadActiveProblems = async () => {
    setLoading(true);
    try {
      // Query Dynatrace for active problems using DQL
      const query = `
        fetch events
        | filter event.kind == "PROBLEM"
        | filter event.status == "ACTIVE"
        | sort timestamp desc
        | limit 20
      `;
      
      const result = await queryExecutionClient.queryExecute({ body: { query } });
      
      // Parse results - queryExecute returns QueryStartResponse with optional result
      const problemRecords = result.result?.records || [];
      const parsedProblems: Problem[] = problemRecords.map((record: any) => ({
        problemId: record['event.id'] || record.problemId || 'unknown',
        displayId: record['event.name'] || record.displayId || 'N/A',
        title: record['event.name'] || record.title || 'Unknown Problem',
        status: record['event.status'] || record.status || 'ACTIVE',
        severityLevel: record['event.level'] || record.severityLevel || 'WARNING',
        startTime: record.timestamp || Date.now(),
        affectedEntities: []
      }));

      setProblems(parsedProblems);
      setLastCheck(new Date());
      addToLog(`Found ${parsedProblems.length} active problems`);
    } catch (error) {
      console.error('Failed to load problems:', error);
      addToLog(`Error loading problems: ${error}`);
      // Fallback: try API endpoint
      try {
        const response = await fetch(`${API_BASE}/dynatrace/problems`);
        const data = await response.json();
        setProblems(data.problems || []);
      } catch (apiError) {
        console.error('API fallback also failed:', apiError);
      }
    } finally {
      setLoading(false);
    }
  };

  const addToLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setFixItLog(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 19)]);
  };

  const triggerFixIt = async (problemId: string) => {
    setTriggering(true);
    addToLog(`Triggering Fix-It agent for problem: ${problemId}`);
    
    try {
      const response = await fetch(`${API_BASE}/workflow-webhook/problem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemId,
          title: problems.find(p => p.problemId === problemId)?.title || 'Unknown Problem',
          severity: problems.find(p => p.problemId === problemId)?.severityLevel || 'WARNING'
        })
      });

      if (response.ok) {
        const result = await response.json();
        addToLog(`✅ Fix-It agent activated successfully`);
        addToLog(`Workflow execution ID: ${result.executionId || 'N/A'}`);
      } else {
        addToLog(`❌ Failed to trigger Fix-It agent: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to trigger Fix-It:', error);
      addToLog(`❌ Error triggering Fix-It: ${error}`);
    } finally {
      setTriggering(false);
    }
  };

  const triggerManualFixIt = () => {
    if (!manualProblemId.trim()) return;
    triggerFixIt(manualProblemId.trim());
    setManualProblemId('');
  };

  const getSeverityColor = (severity: string) => {
    switch (severity?.toUpperCase()) {
      case 'ERROR':
      case 'CRITICAL':
        return '#ff5252';
      case 'WARNING':
        return '#ffa726';
      case 'INFO':
        return Colors.Theme.Critical['70'];
      default:
        return Colors.Text.Primary.Default;
    }
  };

  return (
    <Page>
      <Page.Header>
        <TitleBar>
          <TitleBar.Title>🔧 Fix-It Agent</TitleBar.Title>
          <TitleBar.Subtitle>
            AI-powered autonomous problem remediation with Davis AI
            {lastCheck && ` · Last check: ${lastCheck.toLocaleTimeString()}`}
          </TitleBar.Subtitle>
        </TitleBar>
      </Page.Header>

      <Page.Main>
        <div style={{ padding: 24 }}>
          {/* Status Bar */}
          <div style={{ 
            padding: 20,
            marginBottom: 24,
            background: problems.length > 0 ? 'rgba(255, 82, 82, 0.2)' : 'rgba(115, 190, 40, 0.2)',
            borderRadius: 8,
            border: `2px solid ${problems.length > 0 ? '#ff5252' : Colors.Charts.Categorical.Color02.Default}`
          }}>
            <Flex justifyContent="space-between" alignItems="center">
              <div>
                <Heading level={2} style={{ marginBottom: 8 }}>
                  {problems.length > 0 ? '⚠️ Active Problems Detected' : '✅ No Active Problems'}
                </Heading>
                <Paragraph>
                  <Strong style={{ fontSize: 20 }}>
                    {problems.length} problem{problems.length !== 1 ? 's' : ''}
                  </Strong> {problems.length > 0 ? 'require attention' : 'detected'}
                </Paragraph>
              </div>
              <Button 
                color={loading ? 'neutral' : 'primary'}
                onClick={loadActiveProblems}
                disabled={loading}
              >
                {loading ? '🔄 Checking...' : '🔍 Check for Problems'}
              </Button>
            </Flex>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
            {/* Left Column: Problems List */}
            <div>
              <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: 16 }}>
                <Heading level={3}>🚨 Active Problems</Heading>
                <Paragraph style={{ fontSize: 12, opacity: 0.7 }}>
                  Auto-refreshes every 30 seconds
                </Paragraph>
              </Flex>

              {problems.length === 0 ? (
                <div style={{ 
                  padding: 60,
                  textAlign: 'center',
                  background: Colors.Background.Surface.Default,
                  borderRadius: 8
                }}>
                  <Paragraph style={{ fontSize: 48, marginBottom: 16 }}>✅</Paragraph>
                  <Heading level={3} style={{ marginBottom: 8 }}>All Clear!</Heading>
                  <Paragraph style={{ opacity: 0.7 }}>
                    No active problems detected in your environment
                  </Paragraph>
                </div>
              ) : (
                <Flex flexDirection="column" gap={16}>
                  {problems.map((problem) => (
                    <div
                      key={problem.problemId}
                      style={{
                        padding: 20,
                        background: Colors.Background.Surface.Default,
                        borderRadius: 8,
                        border: `2px solid ${getSeverityColor(problem.severityLevel)}`
                      }}
                    >
                      <Flex justifyContent="space-between" alignItems="flex-start" style={{ marginBottom: 12 }}>
                        <div style={{ flex: 1 }}>
                          <Flex alignItems="center" gap={8} style={{ marginBottom: 8 }}>
                            <span style={{ 
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 'bold',
                              background: getSeverityColor(problem.severityLevel),
                              color: 'white'
                            }}>
                              {problem.severityLevel}
                            </span>
                            <Paragraph style={{ fontSize: 12, opacity: 0.7 }}>
                              {problem.displayId}
                            </Paragraph>
                          </Flex>
                          <Heading level={4} style={{ marginBottom: 8 }}>
                            {problem.title}
                          </Heading>
                          <Paragraph style={{ fontSize: 12, opacity: 0.7 }}>
                            Started: {new Date(problem.startTime).toLocaleString()}
                          </Paragraph>
                        </div>
                        <Button 
                          color="primary"
                          onClick={() => triggerFixIt(problem.problemId)}
                          disabled={triggering}
                        >
                          🔧 Fix It
                        </Button>
                      </Flex>
                    </div>
                  ))}
                </Flex>
              )}

              {/* Manual Trigger Section */}
              <div style={{ 
                marginTop: 24,
                padding: 20,
                background: Colors.Background.Surface.Default,
                borderRadius: 8,
                border: `1px solid ${Colors.Border.Neutral.Default}`
              }}>
                <Heading level={4} style={{ marginBottom: 12 }}>🔧 Manual Fix-It Trigger</Heading>
                <Paragraph style={{ fontSize: 12, marginBottom: 12, opacity: 0.7 }}>
                  Trigger the Fix-It agent for a specific problem ID
                </Paragraph>
                <Flex gap={12}>
                  <TextInput
                    value={manualProblemId}
                    onChange={(value) => setManualProblemId(value)}
                    placeholder="Enter problem ID"
                    style={{ flex: 1 }}
                  />
                  <Button 
                    color="primary"
                    onClick={triggerManualFixIt}
                    disabled={!manualProblemId.trim() || triggering}
                  >
                    Trigger
                  </Button>
                </Flex>
              </div>
            </div>

            {/* Right Column: Activity Log */}
            <div>
              <Heading level={3} style={{ marginBottom: 16 }}>📋 Activity Log</Heading>
              <div style={{ 
                padding: 16,
                background: Colors.Background.Base.Default,
                borderRadius: 8,
                maxHeight: 600,
                overflowY: 'auto',
                fontFamily: 'monospace',
                fontSize: 12
              }}>
                {fixItLog.length === 0 ? (
                  <Paragraph style={{ opacity: 0.5, textAlign: 'center', padding: 20 }}>
                    No activity yet
                  </Paragraph>
                ) : (
                  fixItLog.map((log, idx) => (
                    <div 
                      key={idx}
                      style={{ 
                        padding: '8px 0',
                        borderBottom: idx < fixItLog.length - 1 ? `1px solid ${Colors.Border.Neutral.Default}` : 'none',
                        opacity: 1 - (idx * 0.03)
                      }}
                    >
                      {log}
                    </div>
                  ))
                )}
              </div>

              {/* Info Box */}
              <div style={{ 
                marginTop: 24,
                padding: 16,
                background: 'rgba(0, 161, 201, 0.1)',
                borderRadius: 8
              }}>
                <Heading level={4} style={{ marginBottom: 8 }}>ℹ️ How Fix-It Works</Heading>
                <Paragraph style={{ fontSize: 12, lineHeight: 1.6 }}>
                  The Fix-It agent uses Davis AI to analyze problems, identify root causes, 
                  and execute automated remediation workflows. It can restart services, 
                  clear caches, rollback deployments, and more.
                </Paragraph>
              </div>
            </div>
          </div>
        </div>
      </Page.Main>
    </Page>
  );
};
