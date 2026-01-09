#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configsDir = path.join(__dirname, 'saved-configs');

// Mapping from company names to sector names only
const companyToSector = {
  'Banking Corp': 'Banking',
  'Finance Solutions': 'Financial Services',
  'Hospitality Group': 'Travel & Hospitality',
  'Insurance': 'Insurance',
  'Manufacturing Ltd': 'Manufacturing',
  'Media Corp': 'Media',
  'Retail Group': 'Retail',
  'Telecom Services': 'Telecommunications',
  'Insurance Company': 'Insurance',
  'Banking Corporation': 'Banking',
  'Retail Company': 'Retail', 
  'Healthcare Organization': 'Healthcare',
  'Manufacturing Company': 'Manufacturing',
  'Technology Company': 'Technology',
  'Energy Corporation': 'Energy',
  'Telecommunications Company': 'Telecommunications',
  'Automotive Company': 'Automotive',
  'Transportation Company': 'Transportation',
  'Media Company': 'Media',
  'Education Institution': 'Education',
  'Government Agency': 'Government',
  'Real Estate Company': 'Real Estate',
  'Financial Services': 'Financial Services',
  'Pharmaceutical Company': 'Pharmaceuticals',
  'Food & Beverage Company': 'Food & Beverage',
  'Travel & Hospitality': 'Travel & Hospitality',
  'Construction Company': 'Construction',
  'Agriculture Company': 'Agriculture',
  'Logistics Company': 'Logistics',
  'Mining Company': 'Mining',
  'Utilities Company': 'Utilities',
  'Aerospace Company': 'Aerospace'
};

async function cleanConfigs() {
  try {
    const files = await fs.readdir(configsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    console.log(`🔧 Processing ${jsonFiles.length} config files...`);
    
    for (const file of jsonFiles) {
      const filePath = path.join(configsDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      const config = JSON.parse(content);
      
      // Update company name to sector only
      if (config.companyName && companyToSector[config.companyName]) {
        config.companyName = companyToSector[config.companyName];
        console.log(`✅ Updated ${file}: ${companyToSector[config.companyName]}`);
      }
      
      // Update journeyId to remove company references
      if (config.journeyId && config.companyName) {
        const sectorName = config.companyName.toLowerCase().replace(/\s+/g, '');
        config.journeyId = `journey_${sectorName}_2026`;
      }
      
      // Ensure all required fields are present
      if (!config.id) {
        config.id = crypto.randomUUID();
      }
      
      if (!config.timestamp) {
        config.timestamp = new Date().toISOString();
      }
      
      if (!config.source) {
        config.source = 'sector-demo';
      }
      
      // Write back the cleaned config
      await fs.writeFile(filePath, JSON.stringify(config, null, 2));
    }
    
    console.log(`🎉 Successfully cleaned ${jsonFiles.length} config files!`);
    
  } catch (error) {
    console.error('❌ Error cleaning configs:', error);
  }
}

cleanConfigs();