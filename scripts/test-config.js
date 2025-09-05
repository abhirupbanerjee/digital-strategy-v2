// scripts/test-config.js
/**
 * Configuration Service Test Script
 * Run with: node scripts/test-config.js
 * 
 * This script tests the configuration service without starting the full Next.js app
 */

// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

console.log('=====================================');
console.log('   Configuration Service Test        ');
console.log('=====================================\n');

// Test 1: Check if all required environment variables are present
console.log('📋 Test 1: Checking Required Environment Variables\n');

const requiredEnvVars = [
  'OPENAI_API_KEY',
  'OPENAI_ASSISTANT_ID',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'VERCEL_BLOB_READ_WRITE_TOKEN'
];

const optionalEnvVars = [
  'OPENAI_ORGANIZATION',
  'SUPABASE_ANON_KEY',
  'TAVILY_API_KEY',
  'NEXT_PUBLIC_BASE_URL',
  'SHARE_DEFAULT_EXPIRY_DAYS',
  'SHARE_MAX_EXPIRY_DAYS',
  'DEBUG',
  'DEBUG_CHAT',
  'DEBUG_SYNC',
  'FEATURE_HIERARCHY',
  'FEATURE_BULK_UPLOAD',
  'FEATURE_LM_STUDIO',
  'FEATURE_ADVANCED_SEARCH',
  'FEATURE_AUTH',
  'FEATURE_MAINTENANCE'
];

let missingRequired = [];
let configuredOptional = [];
let missingOptional = [];

// Check required variables
requiredEnvVars.forEach(varName => {
  if (process.env[varName]) {
    console.log(`✅ ${varName}: ${maskValue(process.env[varName])}`);
  } else {
    console.log(`❌ ${varName}: MISSING (REQUIRED)`);
    missingRequired.push(varName);
  }
});

console.log('');

// Check optional variables
optionalEnvVars.forEach(varName => {
  if (process.env[varName]) {
    console.log(`✅ ${varName}: ${maskValue(process.env[varName])}`);
    configuredOptional.push(varName);
  } else {
    console.log(`⚪ ${varName}: Not set (optional)`);
    missingOptional.push(varName);
  }
});

console.log('\n-------------------------------------');
console.log('📊 Summary:');
console.log(`  Required: ${requiredEnvVars.length - missingRequired.length}/${requiredEnvVars.length} configured`);
console.log(`  Optional: ${configuredOptional.length}/${optionalEnvVars.length} configured`);

if (missingRequired.length > 0) {
  console.log(`\n❌ Missing Required Variables:`);
  missingRequired.forEach(v => console.log(`  - ${v}`));
}

// Test 2: Validate environment variable formats
console.log('\n=====================================');
console.log('📋 Test 2: Validating Variable Formats\n');

const validations = {
  OPENAI_API_KEY: {
    pattern: /^sk-(?:proj-)?[a-zA-Z0-9\-_]{20,}$/,
    message: 'Should start with "sk-" or "sk-proj-" followed by 20+ characters'
  },
  OPENAI_ASSISTANT_ID: {
    pattern: /^asst_[a-zA-Z0-9]{20,}$/,
    message: 'Should start with "asst_" followed by 20+ characters'
  },
  OPENAI_ORGANIZATION: {
    pattern: /^org-[a-zA-Z0-9]{20,}$/,
    message: 'Should start with "org-" followed by 20+ characters'
  },
  SUPABASE_URL: {
    pattern: /^https:\/\/[a-zA-Z0-9]+\.supabase\.co$/,
    message: 'Should be a valid Supabase URL (https://xxx.supabase.co)'
  },
  SUPABASE_SERVICE_KEY: {
    pattern: /^eyJ[a-zA-Z0-9._-]+$/,
    message: 'Should be a valid JWT token starting with "eyJ"'
  },
  SUPABASE_ANON_KEY: {
    pattern: /^eyJ[a-zA-Z0-9._-]+$/,
    message: 'Should be a valid JWT token starting with "eyJ"'
  },
  VERCEL_BLOB_READ_WRITE_TOKEN: {
    pattern: /^vercel_blob_[a-zA-Z0-9_]+$/,
    message: 'Should start with "vercel_blob_"'
  },
  TAVILY_API_KEY: {
    pattern: /^tvly[_-][a-zA-Z0-9]+$/,
    message: 'Should start with "tvly-" or "tvly_" followed by alphanumeric characters'
  },
  NEXT_PUBLIC_BASE_URL: {
    pattern: /^https?:\/\/.+$/,
    message: 'Should be a valid URL'
  }
};

let validationErrors = [];

Object.entries(validations).forEach(([varName, validation]) => {
  const value = process.env[varName];
  if (value) {
    if (validation.pattern.test(value)) {
      console.log(`✅ ${varName}: Valid format`);
    } else {
      console.log(`⚠️  ${varName}: Invalid format - ${validation.message}`);
      validationErrors.push(varName);
    }
  }
});

// Test 3: Test configuration loading
console.log('\n=====================================');
console.log('📋 Test 3: Testing Configuration Service\n');

// Check if running in a TypeScript project
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../lib/config/index.ts');
const configExists = fs.existsSync(configPath);

if (!configExists) {
  console.log('⚠️  Configuration service files exist but are TypeScript.');
  console.log('   To test the actual configuration loading:');
  console.log('   1. Run: npm run dev');
  console.log('   2. Check the console for configuration messages');
  console.log('   3. Or use: npx tsx scripts/test-config.ts (if tsx is installed)');
} else if (missingRequired.length === 0) {
  console.log('✅ Configuration files found');
  console.log('   Note: Full testing requires running the Next.js app');
  console.log('   The configuration will be validated when you run: npm run dev');
} else {
  console.log('⚠️  Skipping configuration service test due to missing required variables');
}

// Test 4: Check if TypeScript compilation will work
console.log('\n=====================================');
console.log('📋 Test 4: Checking TypeScript Setup\n');

const tsConfigPath = path.join(__dirname, '../tsconfig.json');
const tsConfigExists = fs.existsSync(tsConfigPath);

if (tsConfigExists) {
  console.log('✅ TypeScript configuration found');
  
  // Check if the app can build
  console.log('   To verify everything compiles:');
  console.log('   1. Run: npm run build');
  console.log('   2. Or for quick check: npx tsc --noEmit');
} else {
  console.log('❌ TypeScript configuration not found');
}

// Final summary
console.log('\n=====================================');
console.log('📊 Test Results Summary\n');

if (missingRequired.length === 0 && validationErrors.length === 0) {
  console.log('✅ All tests passed! Your configuration is ready.');
  console.log('\nNext steps:');
  console.log('  1. Run "npm run dev" to start the development server');
  console.log('  2. Test the application functionality');
  process.exit(0);
} else {
  console.log('⚠️  Configuration issues detected:\n');
  
  if (missingRequired.length > 0) {
    console.log('Missing required variables:');
    missingRequired.forEach(v => {
      console.log(`  - Add ${v} to your .env.local file`);
    });
  }
  
  if (validationErrors.length > 0) {
    console.log('\nInvalid format variables:');
    validationErrors.forEach(v => {
      console.log(`  - Check the format of ${v}`);
    });
  }
  
  console.log('\nPlease fix these issues and run the test again.');
  process.exit(1);
}

// Helper function to mask sensitive values
function maskValue(value) {
  if (!value) return 'NOT SET';
  
  // For boolean values
  if (value === 'true' || value === 'false') return value;
  
  // For numbers
  if (/^\d+$/.test(value)) return value;
  
  // For URLs, show domain only
  if (value.startsWith('http')) {
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.hostname}...`;
    } catch {
      return '***' + value.slice(-4);
    }
  }
  
  // For other sensitive values, show first and last few characters
  if (value.length > 8) {
    return value.substring(0, 4) + '***' + value.slice(-4);
  }
  
  return '***';
}