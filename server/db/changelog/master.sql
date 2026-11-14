--liquibase formatted sql

-- Append immutable changesets below as:
-- Syntax: "changeset team:YYYYMMDD-description" after the SQL comment prefix.
-- Add a rollback directive with the reverse operation.
-- Never edit an applied changeset; append a compensating changeset instead.

--changeset banbanyeok:20261114-initial-schema
-- 비회원 익명 사용자, 방, 참여자. 토큰은 평문이 아니라 HMAC-SHA256(pepper, token) 해시만 저장한다.
CREATE TABLE anon_users (
    id           text PRIMARY KEY,
    device_hash  bytea NOT NULL UNIQUE,
    account_id   text,
    created_at   timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL
);

CREATE TABLE rooms (
    id               text PRIMARY KEY CHECK (id ~ '^[0-9a-hjkmnp-tv-z]{10}$'),
    host_hash        bytea NOT NULL,
    host_pid         text NOT NULL,
    host_anon_id     text REFERENCES anon_users (id) ON DELETE SET NULL,
    mode             text NOT NULL CHECK (mode IN ('fair', 'fast', 'favor')),
    favor_pid        text,
    data_version     text NOT NULL,
    meeting_date     date,
    expected_count   smallint CHECK (expected_count BETWEEN 2 AND 4),
    status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked')),
    outcome          text CHECK (outcome IN ('top1', 'top3', 'other', 'none')),
    outcome_station  text,
    created_at       timestamptz NOT NULL,
    last_activity_at timestamptz NOT NULL,
    expires_at       timestamptz NOT NULL
);
CREATE INDEX rooms_expires_at_idx ON rooms (expires_at);
CREATE INDEX rooms_host_anon_id_idx ON rooms (host_anon_id) WHERE host_anon_id IS NOT NULL;

CREATE TABLE participants (
    room_id     text NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    pid         text NOT NULL,
    anon_id     text REFERENCES anon_users (id) ON DELETE SET NULL,
    token_hash  bytea NOT NULL,
    nickname    text,
    origin_code text NOT NULL CHECK (origin_code ~ '^[0-9a-hjkmnp-tv-z]{3}$'),
    hidden      boolean NOT NULL DEFAULT false,
    joined_at   timestamptz NOT NULL,
    updated_at  timestamptz NOT NULL,
    PRIMARY KEY (room_id, pid)
);
CREATE INDEX participants_anon_id_idx ON participants (anon_id) WHERE anon_id IS NOT NULL;
--rollback DROP TABLE participants; DROP TABLE rooms; DROP TABLE anon_users;

--changeset banbanyeok:20261114-participant-limit splitStatements:false
-- 최대 4명은 애플리케이션(방 행 잠금)과 이 트리거가 함께 강제한다. 앱의 버그가 있어도 5번째 참여자는 들어갈 수 없다.
CREATE FUNCTION enforce_participant_limit() RETURNS trigger AS $$
BEGIN
    PERFORM 1 FROM rooms WHERE id = NEW.room_id FOR UPDATE;
    IF (SELECT count(*) FROM participants WHERE room_id = NEW.room_id) >= 4 THEN
        RAISE EXCEPTION 'room % already has 4 participants', NEW.room_id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER participants_limit BEFORE INSERT ON participants
    FOR EACH ROW EXECUTE FUNCTION enforce_participant_limit();
--rollback DROP TRIGGER participants_limit ON participants; DROP FUNCTION enforce_participant_limit();
