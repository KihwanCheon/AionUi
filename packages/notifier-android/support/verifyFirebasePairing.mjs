import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { firebaseAdmin } from './firebaseAdmin.mjs';

const admin = await firebaseAdmin();
const statePath = path.join(tmpdir(), 'aion-notifier-pairing-smoke.json');
const base = `https://firestore.googleapis.com/v1/projects/${admin.projectId}/databases/(default)/documents`;
const mode = process.argv[2];
if (mode === 'prepare') {
  const startedAt = Date.now();
  const state = {
    projectId: admin.projectId,
    pairingId: randomBytes(32).toString('base64url'),
    sourceId: `smoke-${randomUUID()}`,
    startedAt,
    expiresAt: startedAt + 600000,
  };
  await admin.request(`${base}/pairings/${state.pairingId}`, 'PATCH', {
    fields: {
      sourceId: { stringValue: state.sourceId },
      sourceName: { stringValue: 'Android 연결 검증용 PC' },
      expiresAt: { timestampValue: new Date(state.expiresAt).toISOString() },
      claimedBy: { nullValue: null },
    },
  });
  writeFileSync(statePath, JSON.stringify(state));
  const code = {
    v: 1,
    type: 'aionui_pairing',
    projectId: state.projectId,
    pairingId: state.pairingId,
    expiresAt: state.expiresAt,
  };
  console.log(JSON.stringify({ pairingCodeBase64: Buffer.from(JSON.stringify(code)).toString('base64url') }));
} else {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  if (
    state.projectId !== admin.projectId ||
    !/^smoke-[0-9a-f-]+$/.test(state.sourceId) ||
    !/^[A-Za-z0-9_-]{43}$/.test(state.pairingId)
  )
    throw new Error('검증용 연결 정보가 올바르지 않습니다.');
  if (mode === 'watch') {
    const deadline = Math.min(state.expiresAt, Date.now() + 240000);
    let sent = false;
    console.log('에뮬레이터의 Firebase 기기 연결을 기다립니다.');
    // Claiming precedes registration, which precedes sending to that device.
    /* oxlint-disable no-await-in-loop */
    while (Date.now() < deadline) {
      try {
        const pairing = await admin.request(`${base}/pairings/${state.pairingId}`);
        const uid = pairing.fields?.claimedBy?.stringValue;
        if (!uid) {
          await setTimeout(1000);
          continue;
        }
        const device = await admin.request(`${base}/devices/${encodeURIComponent(uid)}`);
        if (
          device.fields?.pairingId?.stringValue !== state.pairingId ||
          device.fields?.sourceId?.stringValue !== state.sourceId
        )
          throw new Error('검증 기기 등록 불일치');
        const now = Date.now();
        await admin.request(`https://fcm.googleapis.com/v1/projects/${admin.projectId}/messages:send`, 'POST', {
          message: {
            token: device.fields.fcmToken.stringValue,
            android: { priority: 'HIGH', ttl: '120s' },
            data: {
              v: '1',
              type: 'user_choice',
              sourceId: state.sourceId,
              noticeId: 'firebase-live-test',
              title: '기기 연결 테스트',
              body: '연결된 기기로 푸시가 도착했습니다.',
              createdAt: String(now),
              expiresAt: String(now + 120000),
            },
          },
        });
        sent = true;
        console.log('기기 연결 및 등록된 기기로의 푸시 발송 확인');
        break;
      } catch (error) {
        if (!error.message.includes('404 NOT_FOUND')) throw error;
        await setTimeout(1000);
      }
    }
    /* oxlint-enable no-await-in-loop */
    if (!sent) throw new Error('기기 연결 검증 시간이 초과되었습니다.');
  } else if (mode === 'cleanup') {
    const pairing = await admin.request(`${base}/pairings/${state.pairingId}`);
    if (pairing.fields?.sourceId?.stringValue !== state.sourceId) throw new Error('검증 데이터 소유권 불일치');
    const uid = pairing.fields?.claimedBy?.stringValue;
    if (uid) {
      const device = await admin.request(`${base}/devices/${encodeURIComponent(uid)}`);
      if (device.fields?.pairingId?.stringValue !== state.pairingId) throw new Error('검증용 기기 소유권 불일치');
      await admin.request(`${base}/devices/${encodeURIComponent(uid)}`, 'DELETE');
      const accounts = await admin.request(
        `https://identitytoolkit.googleapis.com/v1/projects/${admin.projectId}/accounts:lookup`,
        'POST',
        { localId: [uid] }
      );
      const account = accounts.users?.[0];
      if (
        account &&
        Number(account.createdAt) >= state.startedAt - 30000 &&
        !account.email &&
        !account.providerUserInfo?.length
      ) {
        await admin.request(
          `https://identitytoolkit.googleapis.com/v1/projects/${admin.projectId}/accounts:delete`,
          'POST',
          { localId: uid }
        );
      }
    }
    await admin.request(`${base}/pairings/${state.pairingId}`, 'DELETE');
    unlinkSync(statePath);
    console.log('검증용 기기·연결 데이터 정리 완료');
  } else throw new Error('prepare, watch, cleanup 중 실행할 작업을 지정해 주세요.');
}
