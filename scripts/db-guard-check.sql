-- ADR-0012 4단계 복원 가드(#182). Liquibase 이력 대신 실제 public.participants 테이블과 열을 확인한다.
-- 사용: psql "<대상 DB>" -X -q -v ON_ERROR_STOP=1 -f scripts/db-guard-check.sql
DO $$
DECLARE
    participants_oid oid := pg_catalog.to_regclass('public.participants');
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class
        WHERE oid = participants_oid AND relkind IN ('r', 'p')
    ) THEN
        RAISE EXCEPTION 'guard check failed: public.participants table is missing';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute
        WHERE attrelid = participants_oid AND attname = 'hidden' AND attnum > 0 AND NOT attisdropped
    ) THEN
        RAISE EXCEPTION 'guard check failed: public.participants.hidden still exists';
    END IF;
    RAISE NOTICE 'guard check passed: public.participants has no hidden column';
END;
$$;
