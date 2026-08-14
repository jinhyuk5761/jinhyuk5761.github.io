/**
 * Digital Asset Links.
 *
 * 이 파일이 틀리면 앱이 전체화면 TWA 로 안 뜨고 크롬 커스텀 탭으로 떨어진다.
 * 주소줄과 공유 버튼이 보이는, 딱 봐도 "웹" 인 화면이 된다. 앱 안에서는 아무 오류도
 * 안 나므로 눈으로 보기 전까지 모른다.
 *
 * 특히 지문이 **두 개** 있어야 한다:
 *   - 업로드 키 — 직접 만든 APK 를 폰에 꽂아 설치할 때
 *   - Play 앱 서명 키 — 스토어가 재서명해서 내려주는 앱
 * 하나만 두면 그 경로로 받은 사람만 정상이고 나머지는 웹처럼 보인다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const links = JSON.parse(readFileSync('public/.well-known/assetlinks.json', 'utf8'));

/** 앱 서명 인증서의 SHA-256. 대문자 16진수 32바이트를 콜론으로 잇는다. */
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

describe('assetlinks.json', () => {
  it('패키지와 관계를 정확히 적는다', () => {
    expect(links).toHaveLength(1);
    expect(links[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(links[0].target.namespace).toBe('android_app');
    expect(links[0].target.package_name).toBe('com.metamon.championsmeta');
  });

  it('지문 형식이 맞다', () => {
    for (const fp of links[0].target.sha256_cert_fingerprints) {
      expect(fp).toMatch(FINGERPRINT);
    }
  });

  it('업로드 키와 Play 앱 서명 키를 모두 담는다', () => {
    const prints: string[] = links[0].target.sha256_cert_fingerprints;
    // 업로드 키 — android/app-release-signed.apk 의 인증서와 같아야 한다.
    expect(prints).toContain(
      'C7:96:56:FC:0E:9B:7F:92:6D:7B:30:C9:27:B7:6D:CB:A0:DD:EA:84:57:21:AB:C0:7B:A1:82:E2:DC:67:31:00',
    );
    // Play 앱 서명 키 — 스토어가 재서명해 사용자 폰에 내려주는 앱의 인증서.
    // 이게 빠지면 스토어로 받은 사람만 주소줄 달린 웹 화면을 보게 된다.
    expect(prints).toContain(
      'AF:50:D1:EA:E7:C8:F9:BD:C2:05:0B:78:0F:5F:16:CD:12:B2:52:68:EC:79:33:15:02:81:9D:8E:CD:B2:B7:7E',
    );
    expect(new Set(prints).size).toBe(prints.length);
  });
});
