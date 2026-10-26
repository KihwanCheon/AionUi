import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-aion-notifier-rules';
let environment;

before(async () => {
  // Fail closed rather than accidentally using a production project or another emulator.
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:18080' || process.env.GCLOUD_PROJECT !== PROJECT_ID) {
    throw new Error('npm test로 지정된 로컬 데모 에뮬레이터에서 실행해 주세요.');
  }
  setLogLevel('silent');
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 18080,
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});
beforeEach(async () => {
  await environment.clearFirestore();
});
after(async () => {
  await environment?.cleanup();
});

const database = (uid) =>
  environment.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous', identities: {} } }).firestore();
async function seedPair(claimedBy = null, expiresAt = Date.now() + 600000) {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'pairings', 'test-pair'), {
      sourceId: 'test-pc',
      sourceName: '검증용 PC',
      claimedBy,
      expiresAt: Timestamp.fromMillis(expiresAt),
    });
  });
}
async function registerPhone() {
  await seedPair();
  const owner = database('phone-owner');
  await updateDoc(doc(owner, 'pairings', 'test-pair'), { claimedBy: 'phone-owner', claimedAt: serverTimestamp() });
  await setDoc(doc(owner, 'devices', 'phone-owner'), {
    pairingId: 'test-pair',
    sourceId: 'test-pc',
    deviceName: '검증용 휴대폰',
    fcmToken: 'fixture-token',
    enabled: true,
    updatedAt: serverTimestamp(),
  });
  return owner;
}

test('익명 사용자가 유효한 연결을 소유하고 자신의 기기를 등록한다', async () => {
  const owner = await registerPhone();
  await assertSucceeds(getDoc(doc(owner, 'devices', 'phone-owner')));
  await assertSucceeds(
    updateDoc(doc(owner, 'devices', 'phone-owner'), { enabled: false, updatedAt: serverTimestamp() })
  );
});

test('인증되지 않은 클라이언트는 연결과 기기를 조회할 수 없다', async () => {
  await registerPhone();
  const guest = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(guest, 'pairings', 'test-pair')));
  await assertFails(getDoc(doc(guest, 'devices', 'phone-owner')));
});

test('다른 사용자가 사용된 연결을 재사용하거나 기기를 읽고 삭제할 수 없다', async () => {
  await registerPhone();
  const other = database('another-phone');
  await assertFails(getDoc(doc(other, 'pairings', 'test-pair')));
  await assertFails(
    updateDoc(doc(other, 'pairings', 'test-pair'), { claimedBy: 'another-phone', claimedAt: serverTimestamp() })
  );
  await assertFails(getDoc(doc(other, 'devices', 'phone-owner')));
  await assertFails(deleteDoc(doc(other, 'devices', 'phone-owner')));
});

test('만료된 연결과 소유권 외 필드의 변조를 거부한다', async () => {
  await seedPair(null, Date.now() - 60000);
  const owner = database('phone-owner');
  await assertFails(
    updateDoc(doc(owner, 'pairings', 'test-pair'), { claimedBy: 'phone-owner', claimedAt: serverTimestamp() })
  );
  await seedPair();
  await assertFails(
    updateDoc(doc(owner, 'pairings', 'test-pair'), {
      claimedBy: 'phone-owner',
      claimedAt: serverTimestamp(),
      sourceId: 'forged-pc',
    })
  );
});

test('기기 소유자도 PC ID 변조와 연결 및 기기 목록 조회는 할 수 없다', async () => {
  const owner = await registerPhone();
  await assertFails(
    updateDoc(doc(owner, 'devices', 'phone-owner'), { sourceId: 'forged-pc', updatedAt: serverTimestamp() })
  );
  await assertFails(getDocs(collection(owner, 'devices')));
  await assertFails(getDocs(collection(owner, 'pairings')));
});

test('연결 코드가 만료된 뒤에도 등록된 기기의 토큰 갱신과 연결 해제가 가능하다', async () => {
  const owner = await registerPhone();
  await seedPair('phone-owner', Date.now() - 60000);
  await assertSucceeds(
    updateDoc(doc(owner, 'devices', 'phone-owner'), { fcmToken: 'rotated-fixture-token', updatedAt: serverTimestamp() })
  );
  await assertSucceeds(deleteDoc(doc(owner, 'devices', 'phone-owner')));
});
