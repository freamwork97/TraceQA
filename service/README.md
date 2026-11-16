# TraceQA managed service

Node.js 24, Playwright Chromium, SQLite on a persistent volume. `Dockerfile` installs Chromium and OS dependencies. Startup fixes volume ownership then drops to the node user. One replica, one active exploration at a time.

## Railway

- Project: traceqa / c1438a62-5d29-4033-a79e-2cd10bbe6765
- Production: e8afced4-7a08-4c0f-88a1-060f1d43fd98
- Service: traceqa-worker / 76c6021d-4f8f-42b4-a225-6301454caacb
- Volume: /data, 512 MB. Database: /data/traceqa.sqlite.
- Resource limit: 1 vCPU, 1 GB RAM. No guaranteed monthly cost: Railway meters actual usage.
- Runtime: 30 minutes per run, no depth limit. User-selected credit budget also stops a run.

## Secrets and identity

`SERVICE_TOKEN` authenticates server-to-server requests from the Sites gateway. The gateway takes visitor identity only from Sites dispatch and replaces all client-supplied identity and auth headers. Customers never receive the service token or OpenAI key.

Operator must set `OPENAI_API_KEY` in this service's Railway Variables. The production key has been registered directly in Railway Variables. Never commit it or put it in frontend JavaScript. The operator supplied the key directly; no key value is kept in this repository.

Sites runtime values: `SERVICE_URL` (Railway HTTPS origin), `SERVICE_TOKEN` (same secret). No browser-side worker configuration.

## Billing · Toss Payments

토스페이먼츠 V2 SDK의 카드/간편결제 통합결제창으로 일회성 원화 크레딧 충전을 제공합니다. **현재 테스트 결제만 지원**하며 live 키는 코드에서 거부합니다. 기존 Stripe 결제 경로는 제거했습니다. 이전 orders/payment_events 테이블은 기록 보존을 위해 남겨두고, 새 주문은 별도 toss_orders 테이블에 저장합니다.

Railway Variables에 운영자가 아래 값을 설정합니다. 고객이 키를 입력하는 구조가 아닙니다.

| 변수 | 값 |
| --- | --- |
| TOSS_CLIENT_KEY | API 개별 연동 테스트 클라이언트 키, test_ck_로 시작 |
| TOSS_SECRET_KEY | 같은 상점의 테스트 시크릿 키, test_sk_로 시작 |
| CREDIT_PACK_AMOUNT_KRW | 1회 충전 상품의 원화 결제 금액, 양의 정수 |
| CREDIT_PACK_CREDITS | 1회 충전 상품에서 지급할 크레딧, 양의 정수 |

요금은 임의로 설정하지 않았습니다. 네 값이 모두 준비되기 전에는 충전 버튼이 비활성 상태입니다. 주문서형/결제위젯 test_gck/test_gsk 키가 아닌 **API 개별 연동 키**가 필요합니다. 실제 결제 활성화에는 가맹점 계약·심사 및 취소/환불/약관 등 운영 정책의 추가 구현이 필요합니다.

흐름: 로그인한 사용자 주문 생성 → /checkout 주문서 → 토스 테스트 결제창 → /payment/success에서 서버 승인 요청 → 서버 저장 금액·소유자 확인 → 토스 승인 API → DONE 상태·금액·통화·결제키 대조 → 트랜잭션으로 1회 지급. 성공 URL 방문만으로는 크레딧이 지급되지 않습니다. API timeout 뒤 동일 결제키로 재시도하면 이미 승인된 결제를 조회해 복구합니다. 다른 사용자의 주문과 금액 변조 요청은 토스 API 호출 전에 거부합니다.

가상계좌·계좌이체·정기결제 및 비동기 입금 웹훅은 이번 연동에서 지원하지 않습니다. 결제창 요청은 CARD 방식입니다. 카드번호는 토스에서 처리하고 TraceQA 서버에 저장하지 않습니다. 시크릿 키는 Railway에만 보관하며 클라이언트 키만 주문서에 전달합니다. CSP에 토스 SDK·프레임 출처를 허용했습니다.

크레딧 모델은 실행별 예산 예약 → 성공한 고유 화면당 1크레딧 사용 → 종료 시 미사용 예약분 반환입니다. 중복 화면과 실패한 AI 분석은 차감하지 않습니다. 장부와 화면 중복 키는 SQLite에 영구 저장합니다.

공식 자료:
- https://docs.tosspayments.com/guides/v2/payment-window/integration
- https://docs.tosspayments.com/sdk/v2/js/environment
- https://docs.tosspayments.com/reference

## Readiness and limits

GET `/health` is public, exposes service/version only, and proves process health. Authenticated GET `/status` reports AI key presence, installed Chromium and Toss test payment configuration. Key presence is not proof of API quota or model access. All other internal routes require a service token and a gateway-supplied user ID. The gateway exposes only user endpoints; payment confirmation remains server-side.

This is a single-instance MVP, not a distributed queue. SQLite snapshots can grow with screenshots. Configure retention and object storage before high-volume use; monitor the 512 MB volume. A restart marks interrupted runs and releases unused holds; it does not resume browser state. DNS checks do not fully prevent rebinding; enforce private-address egress restrictions before accepting untrusted production customers. Login sessions, iframe recursion, manual assertions, production payments and dispute/refund workflows are not included.

`node --test service/test.mjs gateway/test.mjs worker/test.mjs` tests ledger integrity, Toss confirmation and payment verification, owner isolation, gateway identity, and target policies without incurring AI charges.
