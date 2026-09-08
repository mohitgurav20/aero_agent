/**
 * SIH26171 — Client-Side Extension PII & Privacy Filter Test
 * Validates extension/pii_detector.js against Indian PII regulations and password masking.
 */

const fs = require('fs');

// Mock window environment for Node.js
const mockWindow = {};
const piiDetectorCode = fs.readFileSync('extension/pii_detector.js', 'utf8');
const runInContext = new Function('window', piiDetectorCode);
runInContext(mockWindow);

const PIIDetector = mockWindow.PIIDetector;

console.log('='.repeat(70));
console.log(' 🛡️  EXTENSION CLIENT-SIDE PII FILTER TEST (extension/pii_detector.js)');
console.log('='.repeat(70));

let passed = 0;
let total = 4;

// 1. Check Password Masking
console.log('\n[TEST 1/4] Password Field Sanitization:');
const sampleElements1 = [
  { tag: 'input', type: 'password', name: 'user_pass', value: 'Secret_Password#999' }
];
const clean1 = PIIDetector.sanitizeElements(sampleElements1);
if (clean1[0].value === '●●●●●●') {
  console.log('  ✓ Pass: Password input sanitized to "●●●●●●" (Plaintext eliminated)');
  passed++;
} else {
  console.error('  ✗ Fail: Password was not masked!', clean1[0].value);
}

// 2. Check Aadhaar Masking
console.log('\n[TEST 2/4] Aadhaar Detection & Masking:');
const sampleElements2 = [
  { tag: 'input', type: 'text', value: '4589 1234 5678', text: 'Aadhaar ID' }
];
const clean2 = PIIDetector.sanitizeElements(sampleElements2);
if (clean2[0].value === '[REDACTED_AADHAAR]') {
  console.log('  ✓ Pass: Aadhaar number redacted to [REDACTED_AADHAAR]');
  passed++;
} else {
  console.error('  ✗ Fail: Aadhaar was not masked!', clean2[0].value);
}

// 3. Check PAN Card Masking
console.log('\n[TEST 3/4] PAN Card Detection & Masking:');
const sampleElements3 = [
  { tag: 'span', text: 'Account Holder PAN: ABCDE1234F verified' }
];
const clean3 = PIIDetector.sanitizeElements(sampleElements3);
if (clean3[0].text.includes('[REDACTED_PAN]')) {
  console.log('  ✓ Pass: PAN card redacted to [REDACTED_PAN]');
  passed++;
} else {
  console.error('  ✗ Fail: PAN was not masked!', clean3[0].text);
}

// 4. Check Email & Phone Masking
console.log('\n[TEST 4/4] Email & Phone Detection & Masking:');
const sampleElements4 = [
  { tag: 'p', text: 'Contact scientist@isro.gov.in or call +91 9876543210' }
];
const clean4 = PIIDetector.sanitizeElements(sampleElements4);
if (clean4[0].text.includes('[REDACTED_EMAIL]') && clean4[0].text.includes('[REDACTED_PHONE]')) {
  console.log('  ✓ Pass: Email & Phone redacted to [REDACTED_EMAIL] and [REDACTED_PHONE]');
  passed++;
} else {
  console.error('  ✗ Fail: Email/Phone not masked!', clean4[0].text);
}

console.log('\n' + '='.repeat(70));
console.log(` 🏆 Extension Privacy Filter Result: ${passed}/${total} Passed!`);
console.log('='.repeat(70) + '\n');
