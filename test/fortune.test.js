import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../server.js', import.meta.url));

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(baseUrl, process) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (process.exitCode !== null) throw new Error('Test server exited before becoming ready.');
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not become ready.');
}

test('application API workflows validate auth, money operations, rewards, plans, and fortune redemption', async (t) => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'xplode-fortune-test-'));
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const adminKey = 'fortune-test-admin-key';
  const serverProcess = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      JWT_SECRET: 'fortune-test-jwt-secret',
      FORTUNE_ADMIN_KEY: adminKey,
      DB_PATH: path.join(dataDirectory, 'test.db')
    },
    stdio: 'ignore'
  });

  t.after(async () => {
    serverProcess.kill();
    await once(serverProcess, 'exit').catch(() => {});
    await rm(dataDirectory, { recursive: true, force: true });
  });

  await waitForServer(baseUrl, serverProcess);

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.deepEqual(await healthResponse.json(), { ok: true, message: 'XPLODE backend is running.' });

  const unauthenticatedWalletResponse = await fetch(`${baseUrl}/api/wallet`);
  assert.equal(unauthenticatedWalletResponse.status, 401);

  // Invalid registration: bad invite code AND a 4-digit PIN (5 required).
  const invalidRegistrationResponse = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test-user', email: 'test@example.com', mobile: '0770000000', inviteCode: 'bad', password: 'test-password', pin: '1234' })
  });
  assert.equal(invalidRegistrationResponse.status, 400);

  // Fresh registration — no seeded accounts exist.
  const registrationResponse = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test-user', email: 'test@example.com', mobile: '0770000000', inviteCode: '', password: 'test-password', pin: '54321' })
  });
  assert.equal(registrationResponse.status, 201);
  const registeredUser = await registrationResponse.json();
  assert.equal(registeredUser.wallet.withdrawable, 0);
  assert.ok(/^[0-9]{6}$/.test(registeredUser.user.invite_code), 'every account gets a unique 6-digit invite code');

  // Signing in with the registered credentials (no hardcoded demo login).
  const invalidLoginResponse = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test-user', password: 'incorrect' })
  });
  assert.equal(invalidLoginResponse.status, 401);

  const loginResponse = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test-user', password: 'test-password' })
  });
  assert.equal(loginResponse.status, 200);
  const { token } = await loginResponse.json();
  const authHeaders = { Authorization: `Bearer ${token}` };

  const currentUserResponse = await fetch(`${baseUrl}/api/me`, { headers: authHeaders });
  const currentUserPayload = await currentUserResponse.json();
  assert.equal(currentUserResponse.status, 200);
  assert.equal(currentUserPayload.user.username, 'test-user');
  assert.equal('password_hash' in currentUserPayload.user, false);
  assert.equal('pin_hash' in currentUserPayload.user, false);

  // New accounts start at zero — no invented balances.
  const initialWalletResponse = await fetch(`${baseUrl}/api/wallet`, { headers: authHeaders });
  const { wallet: initialWallet } = await initialWalletResponse.json();
  assert.equal(initialWallet.withdrawable, 0);
  assert.equal(initialWallet.total, 0);

  // A second user registers through the first user's invite code (referral).

  const invalidProfileResponse = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'A' })
  });
  assert.equal(invalidProfileResponse.status, 400);

  const profileResponse = await fetch(`${baseUrl}/api/profile`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Test User One' })
  });
  assert.equal(profileResponse.status, 200);
  assert.equal((await profileResponse.json()).user.full_name, 'Test User One');

  const duplicateRegistrationResponse = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test-user', email: 'test@example.com', mobile: '0770000000', inviteCode: '', password: 'test-password', pin: '54321' })
  });
  assert.equal(duplicateRegistrationResponse.status, 409);

  const referralRegistrationResponse = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'referral-user',
      email: 'referral@example.com',
      mobile: '0770000001',
      inviteCode: registeredUser.user.invite_code,
      password: 'referral-password',
      pin: '54321'
    })
  });
  assert.equal(referralRegistrationResponse.status, 201);

  const invalidDepositResponse = await fetch(`${baseUrl}/api/wallet/deposit`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 1000, provider: 'MTN Mobile Money', transactionId: 'TEST-TX-0001' })
  });
  assert.equal(invalidDepositResponse.status, 400);

  const unsupportedProviderResponse = await fetch(`${baseUrl}/api/wallet/deposit`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 10000, provider: 'Unsupported', transactionId: 'TEST-TX-0002' })
  });
  assert.equal(unsupportedProviderResponse.status, 400);

  const mtnDepositResponse = await fetch(`${baseUrl}/api/wallet/deposit`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 15000, provider: 'MTN Mobile Money', transactionId: 'TEST-TX-MTN-1', payerNumber: '0780000000' })
  });
  assert.equal(mtnDepositResponse.status, 201);
  const mtnDeposit = await mtnDepositResponse.json();
  assert.equal(mtnDeposit.deposit.provider, 'MTN Mobile Money');

  const configResponse = await fetch(`${baseUrl}/api/config`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.ok(config.depositAccounts['MTN Mobile Money']);
  assert.ok(config.depositAccounts['Airtel Money']);

  const depositResponse = await fetch(`${baseUrl}/api/wallet/deposit`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 10000, provider: 'Airtel Money', transactionId: 'TEST-TX-0003', payerNumber: '0770000000' })
  });
  assert.equal(depositResponse.status, 201);
  const submittedDeposit = await depositResponse.json();
  assert.equal(submittedDeposit.deposit.status, 'pending');
  assert.match(submittedDeposit.message, /manual verification/);

  // Wallet snapshot before any crediting happens.
  const walletBeforeResponse = await fetch(`${baseUrl}/api/wallet`, { headers: authHeaders });
  const walletBefore = (await walletBeforeResponse.json()).wallet;

  const duplicateDepositResponse = await fetch(`${baseUrl}/api/wallet/deposit`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 10000, provider: 'Airtel Money', transactionId: 'TEST-TX-0003' })
  });
  assert.equal(duplicateDepositResponse.status, 409);

  // Admin queue: unauthenticated access is refused.
  const unauthAdminResponse = await fetch(`${baseUrl}/api/admin/deposits`);
  assert.equal(unauthAdminResponse.status, 401);

  // SMS auto-credit: an MTN payment SMS matching the pending MTN deposit's
  // amount + payer number credits it with no human action.
  const smsIngestResponse = await fetch(`${baseUrl}/api/sms/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    body: JSON.stringify({
      sender: 'MTN',
      body: 'MTN MoMo: You have received UGX 15,000 from 0780000000 on your number 0788734485. Financial Transaction ID: 987654321. New balance: UGX 100,000'
    })
  });
  assert.equal(smsIngestResponse.status, 200);
  const smsResult = await smsIngestResponse.json();
  assert.equal(smsResult.results[0].action, 'credited');
  assert.ok(smsResult.results[0].credited);

  const walletAfterSmsResponse = await fetch(`${baseUrl}/api/wallet`, { headers: authHeaders });
  const walletAfterSms = (await walletAfterSmsResponse.json()).wallet;
  assert.equal(Number(walletAfterSms.withdrawable), Number(walletBefore.withdrawable) + 15000);

  // The credited MTN deposit must now be settled in the admin queue.
  const queueAfterSms = await (await fetch(`${baseUrl}/api/admin/deposits`, { headers: { 'X-Admin-Key': adminKey } })).json();
  const settledMtn = queueAfterSms.deposits.find((entry) => entry.transaction_id === 'TEST-TX-MTN-1');
  assert.equal(settledMtn.status, 'confirmed');

  // Replaying the same SMS must not credit anything again.
  const smsRepeatResponse = await fetch(`${baseUrl}/api/sms/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    body: JSON.stringify({
      sender: 'MTN',
      body: 'MTN MoMo: You have received UGX 15,000 from 0780000000 on your number 0788734485. Financial Transaction ID: 987654321. New balance: UGX 100,000'
    })
  });
  const smsRepeat = await smsRepeatResponse.json();
  assert.equal(smsRepeat.results[0].action, 'no_match');

  // Manual approve flow on the Airtel deposit.
  const adminQueueResponse = await fetch(`${baseUrl}/api/admin/deposits`, {
    headers: { 'X-Admin-Key': adminKey }
  });
  assert.equal(adminQueueResponse.status, 200);
  const adminQueue = await adminQueueResponse.json();
  const pendingAirtel = adminQueue.deposits.find((entry) => entry.transaction_id === 'TEST-TX-0003');
  assert.ok(pendingAirtel, 'Submitted Airtel deposit should appear in the admin queue');
  assert.equal(pendingAirtel.status, 'pending');

  const approveResponse = await fetch(`${baseUrl}/api/admin/deposits/${pendingAirtel.id}/approve`, {
    method: 'POST',
    headers: { 'X-Admin-Key': adminKey }
  });
  assert.equal(approveResponse.status, 200);
  assert.equal((await approveResponse.json()).deposit.status, 'confirmed');

  const walletAfterResponse = await fetch(`${baseUrl}/api/wallet`, { headers: authHeaders });
  const walletAfter = (await walletAfterResponse.json()).wallet;
  assert.equal(Number(walletAfter.withdrawable), Number(walletAfterSms.withdrawable) + 10000);
  assert.equal(Number(walletAfter.total), Number(walletAfterSms.total) + 10000);

  const reApproveResponse = await fetch(`${baseUrl}/api/admin/deposits/${pendingAirtel.id}/approve`, {
    method: 'POST',
    headers: { 'X-Admin-Key': adminKey }
  });
  assert.equal(reApproveResponse.status, 409);

  // Reject flow on a fresh deposit.
  const rejectTargetResponse = await fetch(`${baseUrl}/api/wallet/deposit`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 12000, provider: 'Airtel Money', transactionId: 'TEST-TX-REJECT-1', payerNumber: '0770000000' })
  });
  assert.equal(rejectTargetResponse.status, 201);
  const rejectTarget = await rejectTargetResponse.json();

  const rejectResponse = await fetch(`${baseUrl}/api/admin/deposits/${rejectTarget.deposit.id}/reject`, {
    method: 'POST',
    headers: { 'X-Admin-Key': adminKey }
  });
  assert.equal(rejectResponse.status, 200);
  assert.equal((await rejectResponse.json()).deposit.status, 'rejected');

  const depositsResponse = await fetch(`${baseUrl}/api/deposits`, { headers: authHeaders });
  const deposits = await depositsResponse.json();
  assert.equal(deposits.success, true);
  assert.ok(deposits.deposits.some((deposit) => deposit.transaction_id === 'TEST-TX-0003'));

  const invalidPinResponse = await fetch(`${baseUrl}/api/wallet/withdraw`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 5000, pin: '00000', accountProvider: 'Airtel Money', accountName: 'Test User One', accountNumber: '0770000000' })
  });
  assert.equal(invalidPinResponse.status, 400);

  const missingAccountResponse = await fetch(`${baseUrl}/api/wallet/withdraw`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 5000, pin: '54321' })
  });
  assert.equal(missingAccountResponse.status, 400);

  const withdrawalResponse = await fetch(`${baseUrl}/api/wallet/withdraw`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 5000, pin: '54321', accountProvider: 'Airtel Money', accountName: 'Test User One', accountNumber: '0770000000' })
  });
  assert.equal(withdrawalResponse.status, 201);
  const submittedWithdrawal = await withdrawalResponse.json();
  assert.equal(submittedWithdrawal.withdrawal.status, 'pending');
  assert.equal(submittedWithdrawal.withdrawal.account_number, '0770000000');
  assert.equal(submittedWithdrawal.withdrawal.fee, 500);
  assert.equal(submittedWithdrawal.withdrawal.payout_amount, 4500);

  const excessiveWithdrawalResponse = await fetch(`${baseUrl}/api/wallet/withdraw`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 999999999, pin: '54321', accountProvider: 'Airtel Money', accountName: 'Test User One', accountNumber: '0770000000' })
  });
  assert.equal(excessiveWithdrawalResponse.status, 400);

  const withdrawalsResponse = await fetch(`${baseUrl}/api/withdrawals`, { headers: authHeaders });
  const withdrawals = await withdrawalsResponse.json();
  assert.equal(withdrawals.available, 20000);

  // Admin payout flow: stats + users + mark-paid debits the wallet; reject refunds.
  const adminStatsResponse = await fetch(`${baseUrl}/api/admin/stats`, { headers: { 'X-Admin-Key': adminKey } });
  assert.equal(adminStatsResponse.status, 200);
  const adminStats = (await adminStatsResponse.json()).stats;
  assert.ok(adminStats.users >= 1);
  assert.ok(adminStats.pendingWithdrawals.count >= 1);

  const adminUsersResponse = await fetch(`${baseUrl}/api/admin/users`, { headers: { 'X-Admin-Key': adminKey } });
  assert.equal(adminUsersResponse.status, 200);
  const adminUsers = (await adminUsersResponse.json()).users;
  assert.ok(adminUsers.some((user) => user.username === 'test-user'));

  const adminWithdrawalsResponse = await fetch(`${baseUrl}/api/admin/withdrawals`, { headers: { 'X-Admin-Key': adminKey } });
  const adminWithdrawals = (await adminWithdrawalsResponse.json()).withdrawals;
  const pendingPayout = adminWithdrawals.find((row) => row.status === 'pending');
  assert.ok(pendingPayout, 'pending withdrawal should appear in payout queue');
  assert.equal(pendingPayout.username, 'test-user');

  const walletBeforePayoutResponse = await fetch(`${baseUrl}/api/wallet`, { headers: authHeaders });
  const walletBeforePayout = (await walletBeforePayoutResponse.json()).wallet;

  const payoutResponse = await fetch(`${baseUrl}/api/admin/withdrawals/${pendingPayout.id}/approve`, {
    method: 'POST',
    headers: { 'X-Admin-Key': adminKey }
  });
  assert.equal(payoutResponse.status, 200);
  assert.equal((await payoutResponse.json()).withdrawal.status, 'paid');

  const walletAfterPayoutResponse = await fetch(`${baseUrl}/api/wallet`, { headers: authHeaders });
  const walletAfterPayout = (await walletAfterPayoutResponse.json()).wallet;
  assert.equal(Number(walletAfterPayout.withdrawable), Number(walletBeforePayout.withdrawable) - 5000);
  assert.equal(Number(walletAfterPayout.total), Number(walletBeforePayout.total) - 5000);

  const rePayoutResponse = await fetch(`${baseUrl}/api/admin/withdrawals/${pendingPayout.id}/approve`, {
    method: 'POST',
    headers: { 'X-Admin-Key': adminKey }
  });
  assert.equal(rePayoutResponse.status, 409);

  // Operator powers: manual balance adjustments are signed, validated, logged.
  const testUserRecord = adminUsers.find((user) => user.username === 'test-user');
  const creditResponse = await fetch(`${baseUrl}/api/admin/users/${testUserRecord.id}/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    body: JSON.stringify({ amount: 2500 })
  });
  assert.equal(creditResponse.status, 200);
  assert.ok((await creditResponse.json()).message.includes('Credited UGX 2,500'));

  const debitResponse = await fetch(`${baseUrl}/api/admin/users/${testUserRecord.id}/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    body: JSON.stringify({ amount: -1000 })
  });
  assert.equal(debitResponse.status, 200);
  const walletAfterAdjust = await (await fetch(`${baseUrl}/api/wallet`, { headers: authHeaders })).json();
  assert.equal(Number(walletAfterAdjust.wallet.withdrawable), Number(walletAfterPayout.withdrawable) + 1500);

  const overdraftAdjustResponse = await fetch(`${baseUrl}/api/admin/users/${testUserRecord.id}/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    body: JSON.stringify({ amount: -99999999 })
  });
  assert.equal(overdraftAdjustResponse.status, 409, 'cannot debit below zero');

  const zeroAdjustResponse = await fetch(`${baseUrl}/api/admin/users/${testUserRecord.id}/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    body: JSON.stringify({ amount: 0 })
  });
  assert.equal(zeroAdjustResponse.status, 400);

  const clientAdjustResponse = await fetch(`${baseUrl}/api/admin/users/${testUserRecord.id}/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ amount: 1000 })
  });
  assert.equal(clientAdjustResponse.status, 401, 'clients cannot adjust balances');

  // Operator powers: deleting a user wipes all their data and protects admins.
  const disposableRegisterResponse = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'delete-me',
      email: 'delete-me@example.com',
      mobile: '0770000000',
      password: 'Delete@123',
      pin: '54321'
    })
  });
  assert.equal(disposableRegisterResponse.status, 201);
  const disposable = await disposableRegisterResponse.json();

  await fetch(`${baseUrl}/api/admin/users/${disposable.user.id}/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    body: JSON.stringify({ amount: 5000 })
  });

  const deleteResponse = await fetch(`${baseUrl}/api/admin/users/${disposable.user.id}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Key': adminKey }
  });
  assert.equal(deleteResponse.status, 200);

  const usersAfterDeleteResponse = await fetch(`${baseUrl}/api/admin/users`, { headers: { 'X-Admin-Key': adminKey } });
  const usersAfterDelete = (await usersAfterDeleteResponse.json()).users;
  assert.ok(!usersAfterDelete.some((user) => user.username === 'delete-me'), 'deleted user disappears from the list');

  const deletedLoginResponse = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'delete-me', password: 'Delete@123' })
  });
  assert.equal(deletedLoginResponse.status, 401, 'deleted user can no longer sign in');

  const adminRecord = usersAfterDelete.find((user) => user.username === 'xplode-admin' || user.username === 'admin');
  assert.ok(adminRecord, 'auto-created admin account is present');
  const deleteAdminAttemptResponse = await fetch(`${baseUrl}/api/admin/users/${adminRecord.id}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Key': adminKey }
  });
  assert.equal(deleteAdminAttemptResponse.status, 409, 'admin accounts cannot be deleted');

  const smsLogResponse = await fetch(`${baseUrl}/api/admin/sms`, { headers: { 'X-Admin-Key': adminKey } });
  assert.equal(smsLogResponse.status, 200);
  const smsLog = (await smsLogResponse.json()).messages;
  assert.ok(smsLog.length >= 2, 'SMS log should hold both ingested messages');

  const fortuneListResponse = await fetch(`${baseUrl}/api/admin/fortune-codes`, { headers: { 'X-Admin-Key': adminKey } });
  assert.equal(fortuneListResponse.status, 200);
  assert.ok(withdrawals.withdrawals.some((withdrawal) => withdrawal.status === 'pending'));
  assert.ok(withdrawals.nextWithdrawalAt, 'expected nextWithdrawalAt cooldown timestamp');

  const teamResponse = await fetch(`${baseUrl}/api/team`, { headers: authHeaders });
  const team = await teamResponse.json();
  assert.equal(team.success, true);
  assert.equal(team.team.direct, 1, 'referral-user registered via test-user invite code');
  assert.equal(team.team.level2, 0);
  assert.equal(team.team.total, 1);

  const rewardStatusResponse = await fetch(`${baseUrl}/api/rewards/status`, { headers: authHeaders });
  const rewardStatus = await rewardStatusResponse.json();
  assert.equal(rewardStatus.success, true);
  assert.equal(rewardStatus.eligible, false);

  const rewardClaimResponse = await fetch(`${baseUrl}/api/rewards/claim`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 1 })
  });
  assert.equal(rewardClaimResponse.status, 409);

  const currentPlanResponse = await fetch(`${baseUrl}/api/plans/current`, { headers: authHeaders });
  assert.equal((await currentPlanResponse.json()).selection.plan, 'basic');

  const invalidPlanResponse = await fetch(`${baseUrl}/api/plans/select`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: 'invalid' })
  });
  assert.equal(invalidPlanResponse.status, 400);

  const premiumPlanResponse = await fetch(`${baseUrl}/api/plans/select`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: 'premium' })
  });
  assert.equal((await premiumPlanResponse.json()).selection.status, 'payment_required');

  for (const page of ['dashboard.html', 'fortune.html', 'plans.html', 'salaries.html']) {
    const pageResponse = await fetch(`${baseUrl}/${page}`);
    assert.equal(pageResponse.status, 200);
    assert.match(pageResponse.headers.get('content-type'), /text\/html/);
  }

  const deniedProvisionResponse = await fetch(`${baseUrl}/api/admin/fortune-codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'FORT-LOCAL100', amount: 100 })
  });
  assert.equal(deniedProvisionResponse.status, 401);

  const provisionResponse = await fetch(`${baseUrl}/api/admin/fortune-codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Fortune-Admin-Key': adminKey },
    body: JSON.stringify({ code: 'FORT-LOCAL100', amount: 100 })
  });
  assert.equal(provisionResponse.status, 201);

  const initialStatusResponse = await fetch(`${baseUrl}/api/fortune`, { headers: authHeaders });
  assert.deepEqual(await initialStatusResponse.json(), { success: true, totalWon: 0, wins: [] });

  const redeem = () => fetch(`${baseUrl}/api/fortune/redeem`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'fort-local100' })
  });
  const redemptionResponses = await Promise.all([redeem(), redeem()]);
  assert.deepEqual(redemptionResponses.map((response) => response.status).sort(), [201, 422]);

  const statusResponse = await fetch(`${baseUrl}/api/fortune`, { headers: authHeaders });
  const status = await statusResponse.json();
  assert.equal(status.totalWon, 100);
  assert.equal(status.wins.length, 1);
  assert.equal(status.wins[0].code, 'FORT-LOCAL100');
  assert.equal(status.wins[0].amount, 100);

  const walletResponse = await fetch(`${baseUrl}/api/wallet`, { headers: authHeaders });
  const { wallet } = await walletResponse.json();
  assert.equal(wallet.withdrawable, 21600);
  assert.equal(wallet.total, 21600);

  const transactionsResponse = await fetch(`${baseUrl}/api/transactions`, { headers: authHeaders });
  const transactions = await transactionsResponse.json();
  assert.ok(transactions.transactions.some((transaction) => transaction.type === 'fortune'));

  const toonSubscribeResponse = await fetch(`${baseUrl}/api/toonhub/subscribe`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 1 })
  });
  const toonSubscribe = await toonSubscribeResponse.json();
  assert.equal(toonSubscribe.status, 'active', 'matching admin-approved deposit activates VIP 1');
  const walletAfterSubscription = await (await fetch(`${baseUrl}/api/wallet`, { headers: authHeaders })).json();
  assert.equal(walletAfterSubscription.wallet.withdrawable, 11600, 'VIP 1 principal is reserved and is not withdrawable');

  const toonStatusResponse = await fetch(`${baseUrl}/api/toonhub/status`, { headers: authHeaders });
  const toonStatus = await toonStatusResponse.json();
  assert.deepEqual(toonStatus.levels.map((level) => level.active), [true, false, false]);

  const startToonWatch = () => fetch(`${baseUrl}/api/toonhub/watch`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 1 })
  });
  assert.equal((await startToonWatch()).status, 201);
  assert.equal((await startToonWatch()).status, 200, 'an unfinished daily watch can be resumed');
  await new Promise((resolve) => setTimeout(resolve, 6100));

  const completeToonWatch = () => fetch(`${baseUrl}/api/toonhub/complete`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 1 })
  });
  assert.equal((await completeToonWatch()).status, 200);
  assert.equal((await startToonWatch()).status, 409, 'a completed level cannot be watched again that day');

  const claimToonReward = () => fetch(`${baseUrl}/api/toonhub/claim`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 1 })
  });
  const dailyClaimResponse = await claimToonReward();
  assert.equal(dailyClaimResponse.status, 201);
  assert.equal((await dailyClaimResponse.json()).amount, 800);
  assert.equal((await claimToonReward()).status, 409, 'a level reward can only be claimed once per day');

  // One active level per client: approving VIP 2 locks VIP 1.
  const pendingToonDepositResponse = await fetch(`${baseUrl}/api/wallet/deposit`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 45000, provider: 'Airtel Money', transactionId: 'TEST-TOON-PENDING' })
  });
  assert.equal(pendingToonDepositResponse.status, 201);
  const pendingToonSubscriptionResponse = await fetch(`${baseUrl}/api/toonhub/subscribe`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 2 })
  });
  assert.equal((await pendingToonSubscriptionResponse.json()).status, 'payment_required',
    'requesting a second level does not lock the active one');

  const pendingToonDeposit = (await (await fetch(`${baseUrl}/api/admin/deposits`, {
    headers: { 'X-Admin-Key': adminKey }
  })).json()).deposits.find((deposit) => deposit.transaction_id === 'TEST-TOON-PENDING');
  const approveToonDepositResponse = await fetch(`${baseUrl}/api/admin/deposits/${pendingToonDeposit.id}/approve`, {
    method: 'POST',
    headers: { 'X-Admin-Key': adminKey }
  });
  assert.equal(approveToonDepositResponse.status, 200);
  const activeToonStatus = await (await fetch(`${baseUrl}/api/toonhub/status`, { headers: authHeaders })).json();
  assert.deepEqual(activeToonStatus.levels.map((level) => level.active), [false, true, false],
    'activating VIP 2 locks VIP 1: only one level stays active');

  const lockedClaimResponse = await fetch(`${baseUrl}/api/toonhub/claim`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ level: 3 })
  });
  assert.equal(lockedClaimResponse.status, 409, 'unpaid levels cannot be claimed');

  const generatedCodeResponse = await fetch(`${baseUrl}/api/admin/fortune-codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    body: JSON.stringify({ amount: 25 })
  });
  assert.equal(generatedCodeResponse.status, 201, 'admin can generate a code by providing only its amount');
  const generatedCode = await generatedCodeResponse.json();
  assert.match(generatedCode.code, /^FORT-[A-F0-9]{8}$/);

  const fortuneClientTokens = [token];
  for (let client = 1; client <= 10; client += 1) {
    const clientResponse = await fetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `fortune-client-${client}`,
        email: `fortune-client-${client}@example.com`,
        mobile: `0770001${String(client).padStart(3, '0')}`,
        password: 'fortune-password',
        pin: '12345'
      })
    });
    assert.equal(clientResponse.status, 201);
    fortuneClientTokens.push((await clientResponse.json()).token);
  }

  const redeemGeneratedCode = (clientToken) => fetch(`${baseUrl}/api/fortune/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clientToken}` },
    body: JSON.stringify({ code: generatedCode.code })
  });
  const firstTenClaims = await Promise.all(fortuneClientTokens.slice(0, 10).map(redeemGeneratedCode));
  assert.ok(firstTenClaims.every((response) => response.status === 201), 'first ten clients claim successfully');
  assert.equal((await redeemGeneratedCode(fortuneClientTokens[10])).status, 422, 'the eleventh client is refused');

  const generatedCodeListResponse = await fetch(`${baseUrl}/api/admin/fortune-codes`, {
    headers: { 'X-Admin-Key': adminKey }
  });
  const generatedCodes = await generatedCodeListResponse.json();
  const listedGeneratedCode = generatedCodes.codes.find((entry) => entry.code === generatedCode.code);
  assert.equal(listedGeneratedCode.redeemed_count, 10);
  assert.equal(listedGeneratedCode.max_redemptions, 10);
});