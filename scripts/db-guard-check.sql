-- 이 DB가 ADR-0012 3단계 서버의 트래픽을 받아도 되는지 확인한다(#182). Liquibase 이력이 아니라 실제 카탈로그를 본다:
-- public.participants에 검증된 participants_hidden_retired CHECK (hidden IS NOT TRUE)가 있고 숨긴 행이 0이어야 한다.
-- 값은 출력하지 않는다. 실패하면 예외로 끝난다(psql -v ON_ERROR_STOP=1이면 exit 3).
-- 사용: psql "<대상 DB>" -X -q -v ON_ERROR_STOP=1 -f scripts/db-guard-check.sql
-- 4단계(열 DROP) 뒤에는 이 제약이 열과 함께 없어지므로, 그 PR에서 이 확인을 "participants에 hidden 열이 없다"로 바꾼다.
DO $$
DECLARE
    guard record;
BEGIN
    IF to_regclass('public.participants') IS NULL THEN
        RAISE EXCEPTION 'guard check failed: public.participants is missing';
    END IF;
    SELECT c.contype, c.convalidated, pg_get_constraintdef(c.oid) AS def
      INTO guard
      FROM pg_constraint c
     WHERE c.conrelid = 'public.participants'::regclass
       AND c.conname = 'participants_hidden_retired';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guard check failed: constraint participants_hidden_retired is missing';
    END IF;
    IF guard.contype <> 'c' THEN
        RAISE EXCEPTION 'guard check failed: constraint participants_hidden_retired is not a CHECK constraint';
    END IF;
    IF NOT guard.convalidated THEN
        RAISE EXCEPTION 'guard check failed: constraint participants_hidden_retired is not validated';
    END IF;
    IF guard.def <> 'CHECK ((hidden IS NOT TRUE))' THEN
        RAISE EXCEPTION 'guard check failed: constraint participants_hidden_retired has an unexpected definition';
    END IF;
    IF EXISTS (SELECT 1 FROM public.participants WHERE hidden IS TRUE) THEN
        RAISE EXCEPTION 'guard check failed: hidden participants remain';
    END IF;
    RAISE NOTICE 'guard check passed: participants_hidden_retired is validated and no hidden participants remain';
END;
$$;
