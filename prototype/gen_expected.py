"""골든 시나리오의 전체 순위 스냅샷(contracts/golden/expected.ranking.json)을 만든다.

Python 프로토타입이 오라클이다. 사람이 검토한 뒤 고정하며, 알고리즘을 바꾸면 이 스크립트를 다시 돌려
diff를 검토한다. Kotlin 각 타깃(jvm·js 등)은 같은 파일을 commonTest에서 읽어 똑같이 재현해야 한다.

사용:
  python3 -B prototype/gen_expected.py          # 파일을 (재)생성한다
  python3 -B prototype/gen_expected.py --check  # 파일이 현재 오라클 결과와 같은지만 확인한다(CI용)
"""
import json
import sys
from pathlib import Path

from algorithm import SCENARIOS_PATH, recommend

EXPECTED_PATH = SCENARIOS_PATH.with_name('expected.ranking.json')
FORMAT_VERSION = 1


def _plain(value):
    """정수로 떨어지는 실수는 정수로 쓴다(30.0 -> 30). JSON 출력이 파이썬/자바스크립트에서 같게 보이도록."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


def snapshot_row(row):
    """추천 문구(reason)는 번역·표현 계층의 몫이라 스냅샷에 넣지 않고 reasonCode만 고정한다."""
    out = {
        'rank': row['rank'],
        'stationId': row['stationId'],
        'times': row['times'],
        'transfers': row['transfers'],
        'maxMinutes': row['maxMinutes'],
        'spreadMinutes': row['spreadMinutes'],
        'totalMinutes': row['totalMinutes'],
    }
    if 'favoredMinutes' in row:
        out['favoredMinutes'] = row['favoredMinutes']
    out['reasonCode'] = row['reasonCode']
    return _plain(out)


def build_snapshot():
    scenarios = json.loads(SCENARIOS_PATH.read_text(encoding='utf-8'))
    cases = []
    for case in scenarios:
        result = recommend(**case['input'])
        cases.append({
            'id': case['id'],
            'status': result['status'],
            'mode': result['mode'],
            'toleranceMinutes': _plain(result['toleranceMinutes']),
            'baselineStationId': result['baselineStationId'],
            'favorCaps': _plain(result['favorCaps']),
            'ranking': [snapshot_row(row) for row in result['recommendations']],
            'excluded': result['excluded'],
        })
    return {
        'formatVersion': FORMAT_VERSION,
        'unit': 'minutes',
        'description': 'prototype/algorithm.py 오라클의 시나리오별 전체 순위. 직접 고치지 말고 prototype/gen_expected.py로 재생성한다.',
        'scenarios': cases,
    }


def render(snapshot):
    return json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n'


def main(argv):
    text = render(build_snapshot())
    if '--check' in argv:
        current = EXPECTED_PATH.read_text(encoding='utf-8') if EXPECTED_PATH.exists() else None
        if current != text:
            print(f'{EXPECTED_PATH} 가 오라클 결과와 다릅니다. gen_expected.py를 실행해 diff를 검토하세요.', file=sys.stderr)
            return 1
        print('expected.ranking.json: 최신')
        return 0
    EXPECTED_PATH.write_text(text, encoding='utf-8')
    print(f'{EXPECTED_PATH} 작성 ({len(json.loads(text)["scenarios"])}개 시나리오)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
