import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { firebaseAdmin } from './firebaseAdmin.mjs';

const admin = await firebaseAdmin();
const run = promisify(execFile);
const serial = process.env.AION_NOTIFIER_TEST_DEVICE || 'emulator-5554';
if (!/^emulator-\d+$/.test(serial)) throw new Error('이 자동 검증은 Android 에뮬레이터 전용입니다.');
const sent = new Set();
const deadline = Date.now() + 240000;
console.log('에뮬레이터의 실제 FCM 테스트 준비를 기다립니다.');
// Device phases must be observed sequentially before each test message is sent.
/* oxlint-disable no-await-in-loop */
while (Date.now() < deadline && sent.size < 2) {
  let fixture;
  try {
    const { stdout } = await run(
      'adb',
      ['-s', serial, 'shell', 'run-as', 'com.mabobsa.aionnotifier', 'cat', 'files/firebase-smoke-token.json'],
      { windowsHide: true, timeout: 5000 }
    );
    fixture = JSON.parse(stdout);
  } catch {
    await setTimeout(1000);
    continue;
  }
  if (!/^smoke-[0-9a-f-]+$/.test(fixture.sourceId) || !['foreground', 'background'].includes(fixture.phase))
    throw new Error('테스트 요청 형식이 올바르지 않습니다.');
  if (!sent.has(fixture.phase)) {
    const now = Date.now();
    await admin.request(`https://fcm.googleapis.com/v1/projects/${admin.projectId}/messages:send`, 'POST', {
      message: {
        token: fixture.token,
        android: { priority: 'HIGH', ttl: '120s' },
        data: {
          v: '1',
          type: 'user_choice',
          sourceId: fixture.sourceId,
          noticeId: `firebase-${fixture.phase}-test`,
          title: 'Firebase 연결 테스트',
          body: '실제 Firebase를 거쳐 도착한 테스트 알림입니다.',
          createdAt: String(now),
          expiresAt: String(now + 120000),
        },
      },
    });
    sent.add(fixture.phase);
    console.log(`${fixture.phase === 'foreground' ? '전경' : '백그라운드'} 테스트 푸시의 Firebase 접수 확인`);
  }
  await setTimeout(1000);
}
/* oxlint-enable no-await-in-loop */
if (sent.size !== 2) throw new Error('실제 FCM 검증의 준비 또는 발송 시간이 초과되었습니다.');
