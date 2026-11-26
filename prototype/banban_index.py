"""반반지수(#202) 한 줄 규칙의 기준 구현과 테스트 벡터(contracts/golden/banban-lines.json) 생성기.

공평 1위 카드·공유 그림·방 미리보기에 붙는 한 줄이다. 기본 층은 늘 가장 오래 걸리는 사람의 시간을 말하고, 걸리는 시간이 고를 때만
강조 층으로 바꾼다. 입력은 화면에 보이는 사람별 분(반올림한 값)이다. 웹 구현은 web/src/lib/result/banban-index.ts이고 이 벡터로 대조한다.
막대 그리기는 대상이 아니다.

사용:
  python3 -B prototype/banban_index.py          # 벡터 파일을 (재)생성한다
  python3 -B prototype/banban_index.py --check  # 파일이 기준 구현의 출력과 같은지 확인한다(CI용)
"""
import json
import random
import sys
from pathlib import Path

VECTORS_PATH = Path(__file__).resolve().parent.parent / 'contracts' / 'golden' / 'banban-lines.json'
SEED = 202
RANDOM_COUNT = 1000
CLOSE_PAIR = 2
CLOSE_GROUP = 6


def format_minutes(minutes):
    hours, rest = divmod(minutes, 60)
    if hours == 0:
        return f'{rest}분'
    return f'{hours}시간' if rest == 0 else f'{hours}시간 {rest}분'


def banban_line(mode, minutes, hidden):
    """공평 기준에서 모두 갈 수 있고 숨긴 사람이 없을 때만 {'kind', 'text'}. 그 밖에는 None."""
    if hidden or mode != 'fair' or len(minutes) < 2 or any(m is None for m in minutes):
        return None
    pair = len(minutes) == 2
    gap = max(minutes) - min(minutes)
    if gap <= (CLOSE_PAIR if pair else CLOSE_GROUP):
        who = '두 사람 ' if pair else '모두 '
        if gap == 0:
            return {'kind': 'close', 'text': f'걸리는 시간이 {who}같아요'}
        tail = ' 차이예요' if pair else ' 차이 안이에요'
        return {'kind': 'close', 'text': f'걸리는 시간이 {who}{format_minutes(gap)}{tail}'}
    return {'kind': 'longest', 'text': f'가장 오래 걸리는 사람도 {format_minutes(max(minutes))}이에요'}


FIXED = [
    ('pair_one_minute', 'fair', [21, 22], False, '2명 1분 차이: 강조 층'),
    ('pair_two_minutes', 'fair', [20, 22], False, '2명 문턱(2분) 안'),
    ('pair_three_minutes', 'fair', [19, 22], False, '2명 문턱 밖: 기본 층'),
    ('pair_same', 'fair', [26, 26], False, '0분 차이'),
    ('group_four_minutes', 'fair', [16, 20, 19], False, '3명 4분 차이: 실제 차이를 말한다'),
    ('group_six_minutes', 'fair', [38, 34, 37, 32], False, '3명 이상 문턱(6분) 안'),
    ('group_seven_minutes', 'fair', [27, 28, 21, 22], False, '3명 이상 문턱 밖'),
    ('group_spread', 'fair', [27, 28, 16, 7], False, '4명 차이 21분: 기본 층'),
    ('group_same', 'fair', [49, 49, 49], False, '3명 0분 차이'),
    ('over_an_hour', 'fair', [46, 53, 94], False, '1시간이 넘는 최장'),
    ('exactly_an_hour', 'fair', [40, 60], False, '정각 1시간'),
    ('origin_is_meeting', 'fair', [0, 31], False, '한 사람이 출발역에서 만난다'),
    ('fast_mode', 'fast', [21, 22], False, '빨리 만나기에는 없다'),
    ('favor_mode', 'favor', [21, 22], False, '누구 쪽으로에는 없다'),
    ('hidden', 'fair', [21, 22], True, '숨긴 사람이 있으면 없다'),
    ('no_route', 'fair', [21, None], False, '갈 수 없는 사람이 있으면 없다'),
    ('one_person', 'fair', [21], False, '한 사람이면 없다'),
]


def random_cases():
    """작은 차이와 1시간이 넘는 최장이 함께 나오게 기준 분에 0~40분을 더한다."""
    rng = random.Random(SEED)
    cases = []
    for i in range(RANDOM_COUNT):
        n = rng.choice((2, 3, 4))
        base = rng.randrange(0, 150)
        minutes = [base + rng.randrange(0, rng.choice((3, 8, 13, 40))) for _ in range(n)]
        cases.append((f'random_{i:04d}', 'fair', minutes, False, None))
    return cases


def build():
    vectors = []
    for vid, mode, minutes, hidden, note in FIXED + random_cases():
        vector = {'id': vid, 'mode': mode, 'minutes': minutes, 'hidden': hidden,
                  'expected': banban_line(mode, minutes, hidden)}
        if note:
            vector['note'] = note
        vectors.append(vector)
    return {
        'version': 1,
        'source': 'prototype/banban_index.py',
        'rule': '공평 기준에서 모두 갈 수 있고 숨긴 사람이 없을 때만. 걸리는 시간 차이(최장 − 최단, 화면 분)가 '
                '2명 2분, 3명 이상 6분 이내면 강조 층(close), 아니면 기본 층(longest)',
        'vectors': vectors,
    }


def render(doc):
    """벡터는 한 줄에 하나(diff를 검토하기 쉽게)."""
    head = {k: v for k, v in doc.items() if k != 'vectors'}
    lines = [json.dumps(v, ensure_ascii=False) for v in doc['vectors']]
    return json.dumps(head, ensure_ascii=False, indent=1)[:-2] + ',\n "vectors": [\n  ' + ',\n  '.join(lines) + '\n ]\n}\n'


def main():
    text = render(build())
    if '--check' in sys.argv:
        if not VECTORS_PATH.exists() or VECTORS_PATH.read_text(encoding='utf-8') != text:
            print(f'{VECTORS_PATH}가 기준 구현과 다릅니다: python3 -B prototype/banban_index.py로 다시 만들고 diff를 검토하세요')
            sys.exit(1)
        print('banban-lines.json 최신')
        return
    VECTORS_PATH.write_text(text, encoding='utf-8')
    print(f'{VECTORS_PATH.name}: 벡터 {len(FIXED) + RANDOM_COUNT}개')


if __name__ == '__main__':
    main()
