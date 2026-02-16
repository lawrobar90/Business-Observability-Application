#!/usr/bin/env node

/**
 * LoadRunner Log Cleanup Utility
 * Keeps only the last 100 lines of each LoadRunner log file to prevent disk fill-up
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../logs');
const MAX_LINES = 100;

function trimLogFile(logPath) {
  try {
    if (!fs.existsSync(logPath)) {
      return;
    }

    const stats = fs.statSync(logPath);
    // Only trim logs larger than 100KB
    if (stats.size < 100 * 1024) {
      return;
    }

    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n');
    
    if (lines.length > MAX_LINES) {
      const trimmedLines = lines.slice(-MAX_LINES);
      fs.writeFileSync(logPath, trimmedLines.join('\n'), 'utf8');
      console.log(`✂️  Trimmed ${logPath} from ${lines.length} to ${MAX_LINES} lines`);
    }
  } catch (err) {
    console.error(`❌ Error trimming ${logPath}:`, err.message);
  }
}

function cleanupOldTestDirectories() {
  const testsDir = path.join(__dirname, '../loadrunner-tests');
  
  try {
    const entries = fs.readdirSync(testsDir, { withFileTypes: true });
    const testDirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name.includes('_2026-'))
      .map(e => ({
        name: e.name,
        path: path.join(testsDir, e.name),
        mtime: fs.statSync(path.join(testsDir, e.name)).mtime.getTime()
      }))
      .sort((a, b) => b.mtime - a.mtime);

    // Keep only the 5 most recent test directories
    if (testDirs.length > 5) {
      const toDelete = testDirs.slice(5);
      toDelete.forEach(dir => {
        try {
          fs.rmSync(dir.path, { recursive: true, force: true });
          console.log(`🗑️  Deleted old test directory: ${dir.name}`);
        } catch (err) {
          console.error(`❌ Error deleting ${dir.name}:`, err.message);
        }
      });
    }
  } catch (err) {
    console.error('❌ Error cleaning up test directories:', err.message);
  }
}

// Main cleanup routine
function cleanup() {
  console.log('🧹 Starting LoadRunner log cleanup...');
  
  // Trim LoadRunner logs
  const logFiles = [
    'loadrunner-manufacturing.log',
    'loadrunner-healthcare.log',
    'loadrunner-retail.log',
    'loadrunner-finance.log',
    'loadrunner-insurance.log'
  ];

  logFiles.forEach(logFile => {
    trimLogFile(path.join(LOGS_DIR, logFile));
  });

  // Clean up old test directories
  cleanupOldTestDirectories();

  console.log('✅ LoadRunner log cleanup complete');
}

// Run cleanup
cleanup();

// If called with --watch, run cleanup every 5 minutes
if (process.argv.includes('--watch')) {
  console.log('👀 Running in watch mode, cleaning up every 5 minutes...');
  setInterval(cleanup, 5 * 60 * 1000);
}
