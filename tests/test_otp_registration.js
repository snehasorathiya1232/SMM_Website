import http from 'http';

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
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
  console.log('Testing OTP Registration flow...');

  const testEmail = `test.verified.${Date.now()}@example.com`;
  const testUser = {
    name: 'Verified Tester',
    username: `tester_${Date.now()}`,
    email: testEmail,
    password: 'Password123!',
    role: 'Creator Pro'
  };

  // Test 1: Send OTP
  console.log('1. Dispatching OTP to', testEmail);
  const sendRes = await post('/api/auth/send-otp', testUser);
  console.log('Send OTP status:', sendRes.status, sendRes.body);
  if (sendRes.status !== 200 || !sendRes.body.success) {
    throw new Error('Failed to send OTP');
  }

  const generatedOtp = sendRes.body.devOtp;
  console.log('Dispatched OTP is:', generatedOtp);

  // Test 2: Verify with incorrect OTP
  console.log('2. Testing incorrect OTP verification (000000)');
  const badVerifyRes = await post('/api/auth/verify-otp', {
    email: testEmail,
    otp: '000000',
    ...testUser
  });
  console.log('Bad OTP status:', badVerifyRes.status, badVerifyRes.body);
  if (badVerifyRes.status === 200) {
    throw new Error('Incorrect OTP was unexpectedly accepted!');
  }

  // Test 3: Verify with correct OTP
  console.log('3. Testing valid OTP verification');
  const goodVerifyRes = await post('/api/auth/verify-otp', {
    email: testEmail,
    otp: generatedOtp,
    ...testUser
  });
  console.log('Good OTP status:', goodVerifyRes.status, goodVerifyRes.body);
  if (goodVerifyRes.status !== 200 || !goodVerifyRes.body.success || !goodVerifyRes.body.user) {
    throw new Error('Valid OTP verification failed');
  }
  console.log('User created:', goodVerifyRes.body.user.id, goodVerifyRes.body.user.email);

  // Test 4: Duplicate email prevention
  console.log('4. Testing duplicate registration prevention');
  const dupSendRes = await post('/api/auth/send-otp', testUser);
  console.log('Duplicate check status:', dupSendRes.status, dupSendRes.body);
  if (dupSendRes.status === 200) {
    throw new Error('Duplicate email was not rejected!');
  }

  console.log('ALL OTP REGISTRATION TESTS PASSED PERFECTLY!');
  process.exit(0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
