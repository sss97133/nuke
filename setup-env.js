#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n🔐 Nuke Environment Setup\n');
console.log('This script will help you set up your local environment variables safely.');
console.log('Your credentials will be saved to a local .env file (which is git-ignored).\n');

const envPath = path.join(__dirname, '.env');

const questions = [
  {
    name: 'VITE_SUPABASE_URL',
    message: 'Enter your Supabase URL (e.g. https://qkgaybvrernstplzjaam.supabase.co):'
  },
  {
    name: 'VITE_SUPABASE_ANON_KEY',
    message: 'Enter your Supabase Anon Key:'
  },
  {
    name: 'VITE_SUPABASE_SERVICE_KEY',
    message: 'Enter your Supabase Service Key (optional):',
    optional: true
  }
];

let envContent = '# Nuke Environment Variables\n# Generated on ' + new Date().toISOString() + '\n\n';

const askQuestion = (index) => {
  if (index >= questions.length) {
    fs.writeFileSync(envPath, envContent);
    console.log('\n✅ Environment variables saved to .env file');
    console.log('🚀 Now you can run the app with: npm run dev\n');
    rl.close();
    return;
  }

  const question = questions[index];
  rl.question(question.message + ' ', (answer) => {
    if (answer.trim() !== '' || question.optional) {
      if (answer.trim() !== '') {
        envContent += `${question.name}=${answer.trim()}\n`;
      }
      askQuestion(index + 1);
    } else {
      console.log('⚠️  This value is required. Please try again.');
      askQuestion(index);
    }
  });
};

console.log('Press Ctrl+C at any time to cancel without saving.\n');
askQuestion(0);
