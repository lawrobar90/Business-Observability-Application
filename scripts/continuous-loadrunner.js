#!/usr/bin/env node

/**
 * Continuous LoadRunner Test Manager
 * Automatically generates and runs LoadRunner tests for continuous load generation
 */

import { spawn, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOADRUNNER_DIR = path.join(__dirname, '../loadrunner-tests');
const ACTIVE_TESTS_FILE = path.join(__dirname, '../logs/active-loadrunner-tests.json');
const LR_MANAGER_SCRIPT = path.join(LOADRUNNER_DIR, 'lr-test-manager.sh');

// Track active LoadRunner tests
class LoadRunnerManager {
  constructor() {
    this.activeTests = this.loadActiveTests();
    // Clear stop flags on fresh startup — stop flags are ephemeral,
    // meant to prevent respawning during an active stop sequence only
    this._clearStopFlag(this._stopAllFlagPath());
    console.log('[LR-Manager] Initialized — stop flags cleared for fresh start');
  }

  // ============================================
  // Stop-Flag Helpers
  // ============================================
  _stopAllFlagPath() {
    return path.join(LOADRUNNER_DIR, 'STOP_ALL');
  }

  _stopCompanyFlagPath(companyName) {
    return path.join(LOADRUNNER_DIR, companyName, 'STOP');
  }

  _writeStopFlag(flagPath) {
    try {
      const dir = path.dirname(flagPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(flagPath, new Date().toISOString());
      console.log(`[LR-Manager] 🏳️  Stop flag written: ${flagPath}`);
    } catch (err) {
      console.error(`[LR-Manager] Failed to write stop flag ${flagPath}:`, err.message);
    }
  }

  _clearStopFlag(flagPath) {
    try {
      if (fs.existsSync(flagPath)) {
        fs.unlinkSync(flagPath);
        console.log(`[LR-Manager] ✅ Stop flag cleared: ${flagPath}`);
      }
    } catch (err) {
      console.error(`[LR-Manager] Failed to clear stop flag ${flagPath}:`, err.message);
    }
  }

  loadActiveTests() {
    try {
      if (fs.existsSync(ACTIVE_TESTS_FILE)) {
        return JSON.parse(fs.readFileSync(ACTIVE_TESTS_FILE, 'utf8'));
      }
    } catch (err) {
      console.error('[LR-Manager] Error loading active tests:', err.message);
    }
    return {};
  }

  saveActiveTests() {
    try {
      fs.writeFileSync(ACTIVE_TESTS_FILE, JSON.stringify(this.activeTests, null, 2));
    } catch (err) {
      console.error('[LR-Manager] Error saving active tests:', err.message);
    }
  }

  /**
   * Generate and start LoadRunner test for a journey
   * @param {Object} journeyConfig - Complete journey configuration
   * @param {String} scenario - light-load, medium-load, heavy-load, etc.
   */
  async startLoadTest(journeyConfig, scenario = 'light-load') {
    const { companyName, domain, industryType, steps } = journeyConfig;
    
    console.log(`[LR-Manager] 🚀 Starting LoadRunner test for ${companyName}`);
    
    // Stop existing test for this company
    await this.stopLoadTest(companyName);
    
    // Clear only the company-specific stop flag (NOT the global STOP_ALL)
    // so the new process can run. If STOP_ALL is set, we should NOT start.
    if (fs.existsSync(this._stopAllFlagPath())) {
      console.log(`[LR-Manager] ⛔ STOP_ALL flag is set — refusing to start new test for ${companyName}`);
      return false;
    }
    this._clearStopFlag(this._stopCompanyFlagPath(companyName));
    
    // Use fixed test directory per company (no timestamps)
    const testDir = path.join(LOADRUNNER_DIR, companyName);
    
    try {
      // Create/update test directory
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      
      // Write test-config.json for Node.js simulator
      const testConfig = {
        companyName,
        domain,
        industryType,
        steps,
        scenario,
        timestamp: new Date().toISOString()
      };
      
      fs.writeFileSync(
        path.join(testDir, 'test-config.json'),
        JSON.stringify(testConfig, null, 2)
      );
      
      console.log(`[LR-Manager] ✅ Using test directory: ${testDir}`);
    } catch (err) {
      console.error(`[LR-Manager] ❌ Failed to create test directory:`, err.message);
      return false;
    }
    
    // Execute LoadRunner test
    const process = await this.executeTest(testDir, scenario);
    
    // Track active test
    this.activeTests[companyName] = {
      testDir,
      scenario,
      pid: process.pid,
      startTime: new Date().toISOString(),
      journeySteps: steps.map(s => s.stepName)
    };
    
    this.saveActiveTests();
    
    console.log(`[LR-Manager] ✅ LoadRunner test started for ${companyName} (PID: ${process.pid})`);
    console.log(`[LR-Manager] 📊 Scenario: ${scenario}, Steps: ${steps.length}, Rate: ${this.getRequestsPerMinute(scenario)}/min`);
    
    return true;
  }
  
  /**
   * Get requests per minute for a scenario
   */
  getRequestsPerMinute(scenario) {
    try {
      const scenarioConfig = JSON.parse(
        fs.readFileSync(path.join(LOADRUNNER_DIR, 'scenarios', `${scenario}.json`), 'utf8')
      );
      const interval = scenarioConfig.loadrunner_config.journey_interval || 30;
      return Math.round(60 / interval);
    } catch (err) {
      return 2; // default
    }
  }

  /**
   * Generate LoadRunner test script (DEPRECATED - now using direct test directory creation)
   * Kept for reference but no longer used
   */
  async generateTest(journeyConfig, scenario) {
    // This method is no longer used - test generation now happens inline in startLoadTest()
    return null;
  }

  /**
   * Execute LoadRunner test (background process)
   */
  async executeTest(testDir, scenario) {
    return new Promise((resolve, reject) => {
      // For now, simulate continuous load by repeatedly calling the journey endpoint
      // In production, this would execute the actual LoadRunner script
      
      const scenarioConfig = JSON.parse(
        fs.readFileSync(path.join(LOADRUNNER_DIR, 'scenarios', `${scenario}.json`), 'utf8')
      );
      
      const interval = scenarioConfig.loadrunner_config.journey_interval || 30; // seconds
      const requestsPerMinute = 60 / interval;
      
      console.log(`[LR-Manager] 📈 Load profile: ${requestsPerMinute} requests/minute`);
      
      // Spawn background process to simulate load
      const process = spawn('node', [
        path.join(__dirname, 'loadrunner-simulator.js'),
        testDir,
        scenario
      ], {
        detached: true,
        stdio: 'ignore'
      });
      
      process.unref();
      resolve(process);
    });
  }

  /**
   * Stop LoadRunner test for a company
   */
  async stopLoadTest(companyName) {
    const test = this.activeTests[companyName];
    
    if (!test) {
      console.log(`[LR-Manager] No active test for ${companyName}`);
      // Still write a stop flag in case an orphan process is running
      this._writeStopFlag(this._stopCompanyFlagPath(companyName));
      return false;
    }
    
    console.log(`[LR-Manager] 🛑 Stopping LoadRunner test for ${companyName} (PID: ${test.pid})`);
    
    // Write stop flag FIRST so the process exits even if SIGKILL doesn't reach it
    this._writeStopFlag(this._stopCompanyFlagPath(companyName));
    
    try {
      process.kill(test.pid, 'SIGKILL');
    } catch (err) {
      console.warn(`[LR-Manager] Could not kill process ${test.pid}:`, err.message);
    }
    
    // Also kill any child processes spawned by this test
    try {
      const { execSync } = await import('child_process');
      execSync(`pkill -9 -P ${test.pid} 2>/dev/null`, { stdio: 'ignore' });
    } catch (e) { /* ignore */ }
    
    delete this.activeTests[companyName];
    this.saveActiveTests();
    
    return true;
  }

  /**
   * Stop all LoadRunner tests
   */
  async stopAllTests() {
    const companies = Object.keys(this.activeTests);
    
    console.log(`[LR-Manager] 🛑 Stopping ${companies.length} active tests...`);
    
    // Write global STOP_ALL flag FIRST — any simulator that checks will exit
    this._writeStopFlag(this._stopAllFlagPath());
    
    for (const company of companies) {
      await this.stopLoadTest(company);
    }
    
    // Nuclear cleanup: kill ALL loadrunner-simulator processes system-wide
    try {
      const { execSync } = await import('child_process');
      execSync('pkill -9 -f "loadrunner-simulator" 2>/dev/null', { stdio: 'ignore' });
      console.log('[LR-Manager] 💣 Killed all loadrunner-simulator processes');
    } catch (e) { /* no processes to kill */ }
    
    // Clear persisted state
    this.activeTests = {};
    this.saveActiveTests();
    
    return companies.length;
  }

  /**
   * Get status of all active tests
   */
  getStatus() {
    const status = {};
    
    for (const [company, test] of Object.entries(this.activeTests)) {
      status[company] = {
        active: true,
        scenario: test.scenario,
        startTime: test.startTime,
        duration: Math.floor((Date.now() - new Date(test.startTime)) / 1000),
        journeySteps: test.journeySteps
      };
    }
    
    return status;
  }

  /**
   * Restore active tests on startup
   */
  async restoreActiveTests() {
    const companies = Object.keys(this.activeTests);
    
    if (companies.length === 0) {
      console.log('[LR-Manager] No active tests to restore');
      return;
    }
    
    console.log(`[LR-Manager] 🔄 Restoring ${companies.length} active LoadRunner tests...`);
    
    // Note: In production, we'd need to read the journey config from the test directory
    // For now, we'll just log that tests need manual restart
    console.warn('[LR-Manager] ⚠️  Auto-restore not yet implemented. Tests need manual restart after server restart.');
  }
}

// Singleton instance
const manager = new LoadRunnerManager();

// Export for use in journey-simulation.js
export default manager;

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  
  switch (command) {
    case 'status':
      console.log(JSON.stringify(manager.getStatus(), null, 2));
      break;
    case 'stop':
      const company = process.argv[3];
      if (company === 'all') {
        manager.stopAllTests();
      } else if (company) {
        manager.stopLoadTest(company);
      } else {
        console.error('Usage: continuous-loadrunner.js stop <company|all>');
      }
      break;
    case 'restore':
      manager.restoreActiveTests();
      break;
    default:
      console.log(`
BizObs Continuous LoadRunner Manager

Usage:
  node continuous-loadrunner.js status              Show active tests
  node continuous-loadrunner.js stop <company>      Stop test for company
  node continuous-loadrunner.js stop all            Stop all tests
  node continuous-loadrunner.js restore             Restore tests after restart
      `);
  }
}
