import http from 'http';

function post(path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'x-bhavishyaa-test-suite': '1',
        ...extraHeaders
      }
    }, res => {
      let resData = '';
      res.on('data', chunk => resData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(resData) });
        } catch {
          resolve({ status: res.statusCode, body: resData });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('Testing Strict Real Email Verification & OTP Registration flow...');

  // Test 1: Reject dummy/non-existent domain (e.g. herjgrj.com)
  console.log('1. Testing dummy/non-existent domain rejection (herjgrj.com)...');
  const fakeRes = await post('/api/auth/send-otp', {
    name: 'Dummy Tester',
    email: 'shhhhkfktr@herjgrj.com',
    password: 'Password123!',
    username: 'dummytest1'
  });
  console.log('Dummy domain response:', fakeRes.status, fakeRes.body);
  if (fakeRes.status !== 400 || !fakeRes.body.error) {
    throw new Error('Expected dummy domain herjgrj.com to be rejected with 400!');
  }
  console.log('✓ Successfully blocked fake domain herjgrj.com');

  // Test 2: Reject disposable email domain (e.g. mailinator.com)
  console.log('2. Testing disposable email rejection (mailinator.com)...');
  const dispRes = await post('/api/auth/send-otp', {
    name: 'Disposable Tester',
    email: 'testuser99@mailinator.com',
    password: 'Password123!',
    username: 'disptest1'
  });
  console.log('Disposable email response:', dispRes.status, dispRes.body);
  if (dispRes.status !== 400 || !dispRes.body.error.includes('Disposable')) {
    throw new Error('Expected disposable domain to be blocked with 400!');
  }
  console.log('✓ Successfully blocked disposable email domain');

  // Test 3: Reject malformed email
  console.log('3. Testing malformed email rejection...');
  const badFmtRes = await post('/api/auth/send-otp', {
    name: 'Bad Format Tester',
    email: 'notanemail',
    password: 'Password123!',
    username: 'badfmt1'
  });
  if (badFmtRes.status !== 400) {
    throw new Error('Expected malformed email to be rejected!');
  }
  console.log('✓ Successfully blocked malformed email');

  // Test 4: Send OTP to genuine email domain (gmail.com)
  const realEmail = `bhavishyaa.verified.${Date.now()}@gmail.com`;
  const realUser = {
    name: 'Verified Real Tester',
    username: `real_${Date.now()}`,
    email: realEmail,
    password: 'Password123!',
    role: 'Creator Pro'
  };

  console.log('4. Dispatching OTP to valid real email domain:', realEmail);
  const sendRes = await post('/api/auth/send-otp', realUser);
  console.log('Send OTP status:', sendRes.status, sendRes.body);
  if (sendRes.status !== 200 || !sendRes.body.success) {
    throw new Error('Failed to send OTP to valid domain: ' + JSON.stringify(sendRes.body));
  }

  const generatedOtp = sendRes.body.devOtp;
  if (!generatedOtp) {
    throw new Error('Expected test suite runner to receive test OTP');
  }
  console.log('✓ Dispatched OTP is:', generatedOtp);

  // Test 5: Verify with incorrect OTP
  console.log('5. Testing incorrect OTP verification (000000)');
  const badVerifyRes = await post('/api/auth/verify-otp', {
    email: realEmail,
    otp: '000000',
    ...realUser
  });
  console.log('Bad OTP status:', badVerifyRes.status, badVerifyRes.body);
  if (badVerifyRes.status === 200) {
    throw new Error('Incorrect OTP was unexpectedly accepted!');
  }
  console.log('✓ Successfully rejected incorrect OTP');

  // Test 6: Verify with correct OTP
  console.log('6. Testing valid OTP verification');
  const goodVerifyRes = await post('/api/auth/verify-otp', {
    email: realEmail,
    otp: generatedOtp,
    ...realUser
  });
  console.log('Good OTP status:', goodVerifyRes.status, goodVerifyRes.body);
  if (goodVerifyRes.status !== 200 || !goodVerifyRes.body.success || !goodVerifyRes.body.user) {
    throw new Error('Valid OTP verification failed');
  }
  console.log('✓ User created successfully:', goodVerifyRes.body.user.id, goodVerifyRes.body.user.email);

  // Test 7: Duplicate email prevention
  console.log('7. Testing duplicate registration prevention');
  const dupSendRes = await post('/api/auth/send-otp', realUser);
  console.log('Duplicate check status:', dupSendRes.status, dupSendRes.body);
  if (dupSendRes.status === 200) {
    throw new Error('Duplicate email was not rejected!');
  }
  console.log('✓ Duplicate email successfully prevented');

  // Test 8: Ensure devOtp is NOT leaked without test-suite header
  console.log('8. Ensuring devOtp is stripped when called without test-suite header');
  const publicEmail = `public.check.${Date.now()}@gmail.com`;
  const publicRes = await new Promise((resolve, reject) => {
    const data = JSON.stringify({
      name: 'Public Tester',
      email: publicEmail,
      password: 'Password123!',
      username: `pub_${Date.now()}`
    });
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/auth/send-otp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let resData = '';
      res.on('data', chunk => resData += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(resData) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
  if (publicRes.body.devOtp) {
    throw new Error('devOtp leaked in public response!');
  }
  console.log('✓ devOtp safely withheld from public clients');

  console.log('\n======================================================');
  console.log('ALL STRICT REAL EMAIL REGISTRATION TESTS PASSED! 🚀');
  console.log('======================================================\n');
  process.exit(0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
