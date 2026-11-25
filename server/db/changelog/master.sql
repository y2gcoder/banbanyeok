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

--changeset banbanyeok:20261116-meeting-time
-- 약속 시각(선택, 분 단위, 서울 시각). 방 결과를 어느 시간대(아침·낮·저녁·밤) 기준으로 계산할지 정한다(contracts/time-slots.json).
-- 약속일(meeting_date)과 같이 방이 지워질 때 함께 지워진다.
ALTER TABLE rooms ADD COLUMN meeting_time time;
--rollback ALTER TABLE rooms DROP COLUMN meeting_time;

--changeset banbanyeok:20261116-meeting-band
-- 약속 시간대(선택). 시각 없이 시간대(아침·낮·저녁·밤)만 고른 방이 쓴다. 화면에 없는 시각을 만들어 저장하지 않으려는 것이다.
-- 시각이 있으면 시간대는 시각에서 나오므로 이 칸은 null이다(둘이 어긋날 수 없게 막는다). 기존 방은 null(= 시각 또는 낮).
ALTER TABLE rooms
    ADD COLUMN meeting_band text CONSTRAINT rooms_meeting_band_check CHECK (meeting_band IN ('morning', 'day', 'evening', 'night')),
    ADD CONSTRAINT rooms_meeting_band_without_time CHECK (meeting_band IS NULL OR meeting_time IS NULL);
--rollback ALTER TABLE rooms DROP COLUMN meeting_band;

--changeset banbanyeok:20261117-room-share-version splitStatements:false
-- 방 공유 버전과 정한 역(#51). 설계: docs/design/room-share-version.md
-- share_version: 미리보기에 보이는 것이 바뀔 때마다 1씩 커지고 줄지 않는다(공유 링크 ?sv=). 내용 해시가 아니라서 같은 상태로
-- 돌아와도 번호는 다시 쓰이지 않는다.
-- decision_basis_version: 정한 역 칸이 마지막으로 바뀐(입력이 바뀌어 풀린 것 포함) share_version. 정하기·풀기는 화면이 본 번호가
-- decision_basis_version 이상, share_version 이하일 때만 받는다.
-- 두 번호는 아래 트리거만 쓴다. 앱이 보낸 값은 무시하고 OLD에서 다시 세므로, 배포 중 옛 서버의 쓰기도 센다.
ALTER TABLE rooms
    ADD COLUMN share_version          bigint NOT NULL DEFAULT 0,
    ADD COLUMN decision_basis_version bigint NOT NULL DEFAULT 0,
    ADD COLUMN decided_station        text CONSTRAINT rooms_decided_station_format CHECK (decided_station ~ '^[0-9a-hjkmnp-tv-z]{3}$'),
    ADD COLUMN decided_by_pid         text,
    ADD COLUMN decided_at             timestamptz,
    ADD CONSTRAINT rooms_decision_complete CHECK (
        (decided_station IS NULL) = (decided_by_pid IS NULL) AND (decided_station IS NULL) = (decided_at IS NULL)
    ),
    ADD CONSTRAINT rooms_decision_basis_le_share CHECK (decision_basis_version BETWEEN 0 AND share_version);

-- 방 행이 바뀔 때: 미리보기에 보이는 칸이 바뀌었거나 참여자 트리거가 올려 달라고 했으면(share_version > OLD) 정확히 1 올린다.
-- 정한 역 칸이 바뀌었거나 참여자 트리거가 풀었으면(decision_basis_version > OLD) 새 번호를 기준 번호로 찍는다.
-- last_activity_at·expires_at·outcome만 바뀌는 쓰기(활동 기록, 결과 설문)는 올리지 않는다.
CREATE FUNCTION rooms_share_version() RETURNS trigger AS $$
DECLARE
    decision_changed boolean;
    preview_changed  boolean;
BEGIN
    decision_changed :=
        (NEW.decided_station, NEW.decided_by_pid, NEW.decided_at)
            IS DISTINCT FROM (OLD.decided_station, OLD.decided_by_pid, OLD.decided_at)
        OR NEW.decision_basis_version > OLD.decision_basis_version;
    preview_changed :=
        decision_changed
        OR NEW.share_version > OLD.share_version
        OR (NEW.mode, NEW.favor_pid, NEW.status, NEW.expected_count, NEW.meeting_date, NEW.meeting_time, NEW.meeting_band)
            IS DISTINCT FROM (OLD.mode, OLD.favor_pid, OLD.status, OLD.expected_count, OLD.meeting_date, OLD.meeting_time, OLD.meeting_band);
    NEW.share_version := OLD.share_version + CASE WHEN preview_changed THEN 1 ELSE 0 END;
    NEW.decision_basis_version := CASE WHEN decision_changed THEN NEW.share_version ELSE OLD.decision_basis_version END;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rooms_share_version BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION rooms_share_version();

-- 참여자가 들어오거나 나가거나(내보내기 포함) 출발역을 바꾸면 입력이 바뀐 것이다: 번호를 올리고 정한 역을 푼다.
-- 별칭·숨기기만 바뀌면 번호만 올린다(시간이 그대로라 정한 역은 남는다). 방이 지워지며 함께 지워질 때는 방 행이 이미 없어 0행이다.
CREATE FUNCTION participants_share_version() RETURNS trigger AS $$
DECLARE
    rid      text;
    releases boolean;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.nickname, NEW.origin_code, NEW.hidden) IS NOT DISTINCT FROM (OLD.nickname, OLD.origin_code, OLD.hidden) THEN
            RETURN NULL;
        END IF;
        rid := NEW.room_id;
        releases := NEW.origin_code IS DISTINCT FROM OLD.origin_code;
    ELSIF TG_OP = 'INSERT' THEN
        rid := NEW.room_id;
        releases := true;
    ELSE
        rid := OLD.room_id;
        releases := true;
    END IF;
    UPDATE rooms SET
        share_version          = share_version + 1,
        decision_basis_version = decision_basis_version + CASE WHEN releases THEN 1 ELSE 0 END,
        decided_station        = CASE WHEN releases THEN NULL ELSE decided_station END,
        decided_by_pid         = CASE WHEN releases THEN NULL ELSE decided_by_pid END,
        decided_at             = CASE WHEN releases THEN NULL ELSE decided_at END
    WHERE id = rid;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER participants_share_version AFTER INSERT OR DELETE OR UPDATE OF nickname, origin_code, hidden ON participants
    FOR EACH ROW EXECUTE FUNCTION participants_share_version();
--rollback DROP TRIGGER participants_share_version ON participants; DROP FUNCTION participants_share_version(); DROP TRIGGER rooms_share_version ON rooms; DROP FUNCTION rooms_share_version(); ALTER TABLE rooms DROP CONSTRAINT rooms_decision_basis_le_share, DROP CONSTRAINT rooms_decision_complete, DROP COLUMN decided_at, DROP COLUMN decided_by_pid, DROP COLUMN decided_station, DROP COLUMN decision_basis_version, DROP COLUMN share_version;

--changeset banbanyeok:20261125-favor-draw splitStatements:false
-- '누구 쪽으로' 뽑기(#172). favor_draw: 방을 만들 때 배려 대상을 뽑기로 정했다. 뽑은 당첨자는 favor_pid에 둔다(결과·미리보기의 배려 대상).
-- draw_generation: 뽑기 세대. 뽑기 전으로 돌아갈 때마다 1씩 커지고 줄지 않는다(리셋 전에 보낸 요청이 재시도돼도 새로 뽑지 않게).
-- draw_round: 그 세대에서 몇 번째 뽑기의 결과인지(0 = 아직, 2 = 다시 뽑음). draw_candidates: 뽑을 때 대상이던 참가자 ID(입장 순서,
-- 숨긴 사람 제외). draw_roster: 뽑을 때 방에 있던 모든 참가자 ID(뒤늦게 들어온 사람과 숨겨서 빠진 사람을 가른다).
-- 대상과 당첨은 참가자 ID·숨김 여부·입장 순서와 서버의 운에서만 나온다(출발역을 보지 않는다).
ALTER TABLE rooms
    ADD COLUMN favor_draw      boolean NOT NULL DEFAULT false,
    ADD COLUMN draw_generation integer NOT NULL DEFAULT 0 CONSTRAINT rooms_draw_generation_nonneg CHECK (draw_generation >= 0),
    ADD COLUMN draw_round      smallint NOT NULL DEFAULT 0 CONSTRAINT rooms_draw_round_range CHECK (draw_round BETWEEN 0 AND 2),
    ADD COLUMN draw_candidates text[],
    ADD COLUMN draw_roster     text[],
    ADD COLUMN drawn_at        timestamptz,
    ADD CONSTRAINT rooms_draw_only_favor CHECK (NOT favor_draw OR mode = 'favor'),
    ADD CONSTRAINT rooms_draw_complete CHECK (
        (draw_round = 0) = (drawn_at IS NULL) AND (draw_round = 0) = (draw_candidates IS NULL)
        AND (draw_round = 0) = (draw_roster IS NULL)
        AND (NOT favor_draw OR (draw_round = 0) = (favor_pid IS NULL))
        AND (favor_draw OR draw_round = 0)
    );

-- 뽑기 규칙을 트리거에 둔다. 배포 중 옛 서버의 쓰기(나가기·기준 바꾸기)에도 CHECK가 깨지지 않게 하려는 것이다.
-- 1. 뽑기 방에서 기준을 favor가 아닌 것으로 바꾸거나, 뽑기 없이 favor_pid가 다른 사람으로 바뀌면 뽑기 방이 아니게 된다
--    (지금 당첨자를 그대로 직접 정하는 것은 새 서버가 favor_draw를 직접 끈다).
-- 2. 당첨자가 비면(나가기·내보내기는 앱이 favor_pid를 비우고, 숨기기는 앱이 같은 트랜잭션에서 비운다) 뽑기 전으로 돌리고 세대를 올린다.
-- 3. 뽑기 칸이 바뀌면 미리보기에 보이는 것이 바뀐 것이라 공유 번호를 올려 달라고 표시한다(share_version > OLD). 정확히 1 올리는 것은
--    20261117-room-share-version의 rooms_share_version이 한다. BEFORE 트리거는 이름순으로 돌므로 이 트리거(rooms_draw_state)가 먼저다.
CREATE FUNCTION rooms_draw_state() RETURNS trigger AS $$
BEGIN
    IF NEW.favor_draw AND (
        NEW.mode IS DISTINCT FROM 'favor'
        OR (NEW.favor_pid IS NOT NULL AND NEW.favor_pid IS DISTINCT FROM OLD.favor_pid
            AND NEW.draw_round = OLD.draw_round AND NEW.draw_generation = OLD.draw_generation)
    ) THEN
        NEW.favor_draw := false;
        NEW.draw_round := 0;
        NEW.draw_candidates := NULL;
        NEW.draw_roster := NULL;
        NEW.drawn_at := NULL;
    ELSIF NEW.favor_draw AND NEW.favor_pid IS NULL AND NEW.draw_round > 0 THEN
        NEW.draw_generation := OLD.draw_generation + 1;
        NEW.draw_round := 0;
        NEW.draw_candidates := NULL;
        NEW.draw_roster := NULL;
        NEW.drawn_at := NULL;
    END IF;
    IF (NEW.favor_draw, NEW.draw_generation, NEW.draw_round, NEW.drawn_at)
        IS DISTINCT FROM (OLD.favor_draw, OLD.draw_generation, OLD.draw_round, OLD.drawn_at) THEN
        NEW.share_version := GREATEST(NEW.share_version, OLD.share_version + 1);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rooms_draw_state BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION rooms_draw_state();
--rollback DROP TRIGGER rooms_draw_state ON rooms; DROP FUNCTION rooms_draw_state(); ALTER TABLE rooms DROP CONSTRAINT rooms_draw_complete, DROP CONSTRAINT rooms_draw_only_favor, DROP COLUMN drawn_at, DROP COLUMN draw_roster, DROP COLUMN draw_candidates, DROP COLUMN draw_round, DROP COLUMN draw_generation, DROP COLUMN favor_draw;
