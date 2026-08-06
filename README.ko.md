# Claude Usage Dashboard

[English](README.md) · [Deutsch](README.de.md) · [한국어](README.ko.md)

Claude Code 세션, 토큰 사용량, 캐시 상태, 할당량 신호 및 예상 비용을
분석하는 로컬 읽기 전용 대시보드입니다.

```bash
git clone https://github.com/ASSERIS-ASI/claude-usage-dashboard.git
cd claude-usage-dashboard
npm ci
npm start
```

브라우저에서 <http://127.0.0.1:3333>을 여십시오. 대시보드는 기존 로컬
로그를 읽고 원본을 변경하지 않으며, 파생 데이터도 로컬에 저장합니다.

Node.js 24 LTS가 필요합니다. 브라우저 라이브러리는 고정된 패키지 의존성에서
로컬로 제공되며, Gelasio·Carlito·Cascadia Code 글꼴은 SIL Open Font License
1.1에 따라 소스 트리에 포함됩니다. CDN에서 가져오는 자산은 없습니다.

첫 실행 시 레이아웃도 함께 준비됩니다. 각 페이지는 편집 가능한 사본 형태의
기본 템플릿으로 시작하며, 기존 레이아웃은 덮어쓰지 않습니다.

## `claude-code-cache-fix`와 함께 사용

초기 설정에서 **Claude Cache Fix**를 추가 서비스로 활성화하고 로컬
`usage.jsonl` 및 사용 가능한 경우 Cache Fix 디버그 로그를 지정하십시오.
Claude 세션 JSONL도 함께 활성화된 상태로 유지합니다. **Claude Code
Meter**도 동시에 활성화할 수 있으며, 동일한 요청 ID를 가진 레코드는
집계 전에 병합되어 중복 계산되지 않습니다.

- `usage.jsonl`은 요청별 토큰 유형, 모델 분포, 캐시 읽기 비율, 임시 캐시
  생성 카운터 및 기록된 5시간/7일 할당량 신호를 추가합니다.
- 호환되는 진단 이벤트 로그는 명시적으로 기록된 적용/건너뜀 수정 활동과
  캐시 TTL 이벤트를 추가할 수 있습니다. 일반 Cache Fix 서버 요청/응답
  추적에서 이러한 이벤트를 추론하지 않습니다.
- 세션 경계, 에이전트 및 컴팩션 분석은 Claude 세션 로그에서 가져옵니다.

이 통합은 파일을 읽기만 합니다. 요청 시간과 HTTP 오류는 `usage.jsonl`에
포함되지 않으며, 별도로 지원되는 소스가 없으면 사용할 수 없고 추정하지
않습니다. 프록시 모드의 request-log 확장이 타이밍 로그를 기록하는 경우
`CACHE_FIX_REQUEST_LOG`로 경로를 지정하면 지연 시간 차트를 사용할 수
있습니다.

## 차트와 데이터 소스

각 데이터 소스는 무엇을 담고 있는지, 각 차트는 무엇을 필요로 하는지
선언합니다. 활성화된 소스가 요구 조건을 제공하지 못하는 차트는 비어 있는
상태로 그려지지 않고 숨겨집니다. 빈 축은 "아무 일도 없었다"로 읽히므로
사실과 다른 진술이 되기 때문입니다. 숨김은 자동으로 되돌아가지 않으며,
나중에 소스를 추가하더라도 레이아웃 빌더에서 다시 켤 때까지 숨겨진 상태로
남습니다.

## 요금 이력

토큰 가격은 예고된 날짜에 변경되므로 하나의 현재 표가 아니라 날짜가 붙은
카드 목록으로 관리합니다. 각 레코드는 자신의 타임스탬프에 유효했던 카드로
계산되므로, 7월의 금액은 오늘 요금으로 조용히 다시 계산되지 않습니다.
기본 제공 카드는 첫 설정 시 상태 디렉터리의 `rate-cards.ndjson`으로
복사되며, 이 파일은 추가만 될 뿐 기존 카드를 수정하지 않습니다.
**Cost Forensic**에서 모델별 이력을 확인할 수 있습니다.

전체 문서는 [README.md](README.md)를 참조하십시오.

## 버전

독립 공개 ASSERIS 릴리스 계보는 **v1.9.0**부터 시작합니다.
`v1.0.0–v1.8.3`은 이전 프로젝트의 공개 기록으로 문서화되며, 기존 Git
태그를 정리된 저장소의 새 커밋으로 다시 지정하지 않습니다.
[CHANGELOG.md](CHANGELOG.md)를 참조하십시오.

저작권 © 2026 ASSERIS AISBL 및 기여자. Apache-2.0 라이선스:
[LICENSE](LICENSE), [NOTICE](NOTICE).

`ASSERIS`, ASSERIS 워드마크 및 로고는 ASSERIS AISBL의 등록 상표입니다.
Apache-2.0은 상표 사용권을 부여하지 않습니다.
[TRADEMARKS.md](TRADEMARKS.md)를 참조하십시오.
