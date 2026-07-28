# MoneyGrow

> 흩어진 금융 데이터를 내 삶의 언어로 정리하고,
> 오늘의 소비를 내일의 자산으로 연결하는 개인 자산관리 프로젝트

<<<<<<< HEAD
=======
MoneyGrow는 부부가 함께 수입·지출·저축·투자 현황을 기록하고, 자산이 실제로 어떻게 움직이는지
추적하기 위해 시작한 개인 프로젝트입니다.

현재는 뱅크샐러드에서 내보낸 엑셀을 기반으로 동작하는 가계부이지만, 최종적으로는 부동산 정보,
공모주 일정, 물가 변화, 목표 자산과 순자산 흐름을 하나의 데이터 모델 안에서 관리하는
**개인 자산 확장 서비스**를 지향합니다.

단순히 지출을 줄이는 도구를 만드는 것이 목표는 아닙니다. 돈을 벌고, 쓰고, 모으고, 투자하며
살아가는 한 사람으로서 내 선택을 데이터로 이해하고 더 나은 결정을 반복하기 위한 시스템을
직접 구축하는 과정입니다.

## 왜 만들었나

금융 데이터는 이미 은행, 카드사, 증권사, 가계부 앱 곳곳에 존재합니다. 하지만 데이터가 많다고
해서 내 자산의 맥락까지 자동으로 설명해 주는 것은 아닙니다.

- 카드 결제와 카드대금이 함께 잡혀 실제 소비가 중복됩니다.
- 부부 사이의 정산 입금은 수입처럼 보이지만 실제로는 지출을 나눈 결과입니다.
- 적금과 투자는 계좌에서 돈이 빠져나가지만 소비가 아니라 자산의 형태가 바뀐 것입니다.
- 결혼자금, 주택구입자금, 비상금처럼 목적이 있는 돈은 일반 지출과 다르게 봐야 합니다.
- 금융 앱이 정한 분류와 내가 살아가는 방식의 분류가 항상 같지는 않습니다.

MoneyGrow는 원본 데이터를 그대로 보존하면서, 사용자가 대분류·메모·정산 관계·예산 목적을
직접 정의할 수 있도록 설계하고 있습니다. 금융회사가 바라보는 거래가 아니라
**내가 이해할 수 있는 자산 데이터**를 만드는 것이 출발점입니다.

## 현재 구현된 기능

### 가계부 데이터 파이프라인

- 뱅크샐러드 엑셀 업로드 및 로컬 폴더 동기화
- 서정·상윤 데이터를 출처 라벨과 함께 통합
- 거래 안정 키 기반 누적 적재 및 중복 방지
- 원본 분류와 사용자 수정 분류를 분리해 저장
- 거래 숨김·복구 및 앱 전용 메모
- 여러 지출과 정산 입금을 하나의 정산 묶음으로 연결

```text
뱅크샐러드 엑셀
    ↓
시트 탐색 및 거래 파싱
    ↓
정규화·출처 라벨링·중복 판별
    ↓
원본 거래 + 사용자 수정 레이어 저장
    ↓
예산 집계·현금흐름·순자산 시각화
```

### 예산 관리

- 월 고정 급여와 급여 대비 예산 배분율
- 생활비, 주거비, 투자·적금·저금, 고정비 월 예산
- 품위유지비와 비상금의 누적·이월 예산
- 대분류와 예산 항목 매핑
- 기간별 예산 저장 및 상세 조회
- 종료된 예산을 새 기간으로 복제하는 예산 재사용
- 월별 실제 사용액, 집행률, 잔액 및 초과액

### 대시보드

- 월별 입금·지출
- 월별 순현금흐름
- 지출 대분류 TOP
- 자산·부채·순자산 스냅샷
- 투자·저축 출금을 소비가 아닌 자산 형성액으로 재해석

### 서비스 설정

- 대분류 추가·이름 변경·삭제
- 예산 항목 표시 이름 수정
- 대분류별 예산 항목 매핑
- 홈, 가계부, 분석, 설정 탭 분리

## 데이터 엔지니어링 관점

MoneyGrow는 개인 거래를 억지로 빅데이터라고 부르는 프로젝트가 아닙니다. 은행·카드·증권,
부동산 실거래가, 공모주, 시장 가격, 금리·환율, 생활 물가처럼 구조와 갱신 주기가 다른 데이터를
안정적으로 수집하고 하나의 자산 모델로 통합하는 **개인 금융 데이터 플랫폼**으로 확장하려 합니다.

기술적 과제는 데이터의 절대적인 크기보다 이질성, 시점 정합성, 스키마 변화, 중복 식별,
재처리 가능성에 있습니다. 모든 수집은 멱등하게 실행하고, 원본과 사용자 해석을 분리하며,
각 지표가 어떤 소스와 규칙에서 만들어졌는지 추적할 수 있는 구조를 지향합니다.

향후에는 Raw·Silver·Gold 계층, 증분 수집과 backfill, 데이터 계약과 품질 검사, 개체 식별,
시계열 이력, 파이프라인 오케스트레이션과 관측 가능성을 단계적으로 도입할 계획입니다.

상세 기능 및 데이터 플랫폼 요구사항은 [`requirements.md`](../requirements.md)에 정리합니다.

## 앞으로의 확장

### 1. 자산 흐름

- 월별 자산·부채 스냅샷
- 순자산 증감 원인 분석
- 저축률과 투자 비중
- 목표 자산 달성률
- 부부 공동 자산 리포트

### 2. 부동산

- 관심 단지 및 보유 부동산 등록
- 실거래가·시세 이력
- 대출과 자기자본을 반영한 실제 자산가치
- 주택구입 목표자금과의 연결

### 3. 공모주

- 청약·환불·상장 일정
- 관심 종목과 주관사 관리
- 청약 자금 배분
- 실제 배정 및 수익률 기록

### 4. 생활 물가

- 자주 구매하는 상품의 가격 이력
- 단위 가격 비교
- 개인 체감 물가와 생활비 변화
- 예산 증가 원인의 데이터 기반 설명

### 5. 분석

- 월간·연간 소비 패턴 비교
- 반복 지출과 구독 탐지
- 예산 초과 가능성 예측
- 자산 배분 변화와 목표 시뮬레이션

## 프로젝트가 담고 싶은 태도

자산을 키운다는 것은 숫자를 크게 만드는 일만은 아니라고 생각합니다.

내가 무엇을 중요하게 여기는지 알고, 지금의 만족과 미래의 안전 사이에서 기준을 만들고,
그 선택에 책임지는 과정에 가깝습니다. 생활비를 관리하면서도 품위유지비를 남겨두고,
비상금을 쌓으면서도 결혼과 주택이라는 목적을 준비하는 이유도 여기에 있습니다.

MoneyGrow에는 데이터를 수집하고 정제하며 신뢰할 수 있는 파이프라인을 만들고 싶은
데이터 엔지니어의 관점과, 스스로의 자산을 책임 있게 키워가려는 한 어른의 관점이 함께 담겨
있습니다.

완벽한 금융 서비스보다 먼저, 오랫동안 실제로 사용할 수 있는 나만의 시스템을 만드는 것이
이 프로젝트의 기준입니다.

## 기술 스택

- Next.js 14 App Router
- React 18
- TypeScript
- Tailwind CSS
- Recharts
- SheetJS (`xlsx`)
- 현재 저장소: 로컬 JSON
- 예정 저장소: PostgreSQL

## 실행 방법

의존성과 Git 저장소는 `web/` 디렉터리를 기준으로 관리합니다.

>>>>>>> bdec29c (docs: MoneyGrow 비전과 데이터 플랫폼 확장 방향 정리)
```bash
npm install
npm run dev
```

<<<<<<< HEAD
또는
=======
브라우저에서 [http://localhost:3000](http://localhost:3000)으로 접속합니다.

프로덕션 검증:

```bash
npm run lint
npm run build
```

## 데이터 보안
>>>>>>> bdec29c (docs: MoneyGrow 비전과 데이터 플랫폼 확장 방향 정리)

실제 금융 거래와 자산 정보는 민감한 개인 데이터입니다.

<<<<<<< HEAD
### `main-app.js` / `app-pages-internals.js` 404

보통 아래 때문에 납니다.

1. **`next dev`가 여러 개 실행됨** — 예전 프로세스가 3000을 잡고 있고, 새로 빌드한 쪽은 다른 포트인데 브라우저만 계속 3000으로 여는 경우.
2. **`.next` 캐시 불일치** — `next build`와 `next dev`를 섞거나, 빌드 도중 끊기면 HTML과 실제 청크가 어긋날 수 있음.

**조치:** 한 번에 dev는 하나만 쓰고, 포트를 꼬이지 않게 정리합니다.

```bash
# 터미널에서 기존 next dev 전부 종료(Ctrl+C) 후
cd web
npm run dev:clean
```

브라우저는 **강력 새로고침**(Chrome: ⌘⇧R) 또는 시크릿 창에서, 터미널에 찍힌 **정확한 `http://localhost:포트`** 로 엽니다.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
=======
- `data/.moneygrow/ledger-state.json`은 Git에 커밋하지 않습니다.
- 원본 엑셀과 로컬 백업 파일도 외부 저장소에 공개하지 않습니다.
- 인터넷에 공개 배포하기 전에는 인증, Household 권한, 암호화 및 접근 제어가 필요합니다.

현재 단계의 MoneyGrow는 신뢰할 수 있는 개인 환경에서 사용하는 것을 전제로 합니다.
>>>>>>> bdec29c (docs: MoneyGrow 비전과 데이터 플랫폼 확장 방향 정리)
