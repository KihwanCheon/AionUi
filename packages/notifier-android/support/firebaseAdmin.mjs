import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import path from 'node:path';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Credentials stay in memory and are never returned in diagnostic output. */
export async function firebaseAdmin() {
  const root = path.join(process.env.LOCALAPPDATA, 'AionUiPush', 'firebase');
  const account = JSON.parse(readFileSync(path.join(root, 'firebase-service-account.json'), 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const signed = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 1800,
  })}`;
  const assertion = `${signed}.${createSign('RSA-SHA256').update(signed).sign(account.private_key).toString('base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(30000),
  });
  const auth = await response.json();
  if (!response.ok || !auth.access_token) throw new Error(`Firebase 인증 실패: ${response.status}`);
  const allowedHosts = new Set([
    'firestore.googleapis.com',
    'firebaserules.googleapis.com',
    'fcm.googleapis.com',
    'identitytoolkit.googleapis.com',
  ]);
  return {
    root,
    projectId: account.project_id,
    async request(url, method = 'GET', body) {
      if (!allowedHosts.has(new URL(url).hostname)) throw new Error('허용되지 않은 API 주소입니다.');
      const options = {
        method,
        headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000),
      };
      if (body !== undefined) {
        if (method === 'GET' || method === 'HEAD') throw new Error('조회 요청에는 본문을 지정할 수 없습니다.');
        options.body = JSON.stringify(body);
      }
      const result = await fetch(url, options);
      const text = await result.text();
      const data = text ? JSON.parse(text) : {};
      if (!result.ok) throw new Error(`Firebase 요청 실패: ${result.status} ${data.error?.status ?? ''}`);
      return data;
    },
  };
}
