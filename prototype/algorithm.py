"""반반역 순위/노선 프로토타입. 모든 시간은 분, 외부 의존성 없음."""
import heapq
import json
import math
from pathlib import Path


def _number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def _rank(rows, keys, tolerance):
    """최솟값 기준 폭 tolerance의 고정 밴드. 비추이적인 쌍별 비교를 쓰지 않는다."""
    if not keys:
        return sorted(rows, key=lambda row: row['stationId'])
    key, *rest = keys
    pending = sorted(rows, key=lambda row: (row[key], row['stationId']))
    ordered = []
    while pending:
        anchor = pending[0][key]
        band = [row for row in pending if row[key] <= anchor + tolerance]
        pending = [row for row in pending if row[key] > anchor + tolerance]
        ordered.extend(_rank(band, rest, tolerance))
    return ordered


def recommend(participants, candidates, times, transfers, mode='fair', tolerance=0):
    """행=참가자, 열=후보역. null은 도달 불가. JSON 직렬화 가능한 결과를 반환한다."""
    if (not 2 <= len(participants) <= 4 or
            any(not isinstance(p, str) or not p for p in participants) or
            len(set(participants)) != len(participants)):
        raise ValueError('참가자 ID는 서로 다른 문자열 2~4개여야 합니다')
    if (any(not isinstance(c, str) or not c for c in candidates) or
            len(set(candidates)) != len(candidates)):
        raise ValueError('후보역 ID는 중복 없는 문자열이어야 합니다')
    if mode not in ['fair', 'fast'] + [f'favor:{p}' for p in participants]:
        raise ValueError('지원하지 않는 모드 또는 참가자입니다')
    if not _number(tolerance):
        raise ValueError('허용오차는 0 이상의 유한한 분 값이어야 합니다')
    n, size = len(participants), len(candidates)
    if any(len(m) != n or any(len(row) != size for row in m) for m in [times, transfers]):
        raise ValueError('행렬 크기가 참가자×후보역과 일치하지 않습니다')
    for ts, xs in zip(times, transfers):
        for t, x in zip(ts, xs):
            if t is None and x is None:
                continue
            if not _number(t) or type(x) is not int or x < 0:
                raise ValueError('시간/환승은 비음수 수치/정수 또는 둘 다 null이어야 합니다')
    rows, excluded = [], []
    for j, candidate in enumerate(candidates):
        ts = [times[i][j] for i in range(n)]
        if None in ts:
            excluded.append({'stationId': candidate, 'reasonCode': 'UNREACHABLE'})
            continue
        rows.append({'stationId': candidate, 'times': ts,
                     'transfers': [transfers[i][j] for i in range(n)],
                     'maxMinutes': max(ts), 'spreadMinutes': max(ts)-min(ts),
                     'totalMinutes': sum(ts)})
    fair_keys = ['maxMinutes', 'spreadMinutes', 'totalMinutes']
    baseline = _rank(rows, fair_keys, 0)[0] if rows else None
    caps = None
    if mode.startswith('favor:') and rows:
        target = participants.index(mode.split(':', 1)[1])
        caps = {p: baseline['times'][i] + min(15, 0.5 * baseline['times'][i])
                for i, p in enumerate(participants) if i != target}
        eligible = []
        for row in rows:
            if any(row['times'][i] > caps[p] for i, p in enumerate(participants) if i != target):
                excluded.append({'stationId': row['stationId'], 'reasonCode': 'FAVOR_CAP_EXCEEDED'})
            else:
                row['favoredMinutes'] = row['times'][target]
                eligible.append(row)
        rows = eligible
        keys = ['favoredMinutes'] + fair_keys
    else:
        keys = fair_keys if mode == 'fair' else ['totalMinutes', 'maxMinutes']
    ordered = _rank(rows, keys, tolerance)
    for index, row in enumerate(ordered):
        row['rank'] = index + 1
        group = '둘 다' if n == 2 else f'{n}명 모두'
        suffix = ' (3분 동점 옵션)' if tolerance == 3 else (f' ({tolerance:g}분 동점 옵션)' if tolerance else '')
        if mode == 'fair':
            row['reasonCode'] = 'FAIR_MINIMAX' if index == 0 else 'FAIR_ALTERNATIVE'
            label = '가장 공평' if index == 0 else '공평 모드 대안'
            row['reason'] = (f"{group} {row['maxMinutes']:g}분 안쪽, {label}"
                             f" · 최장 {row['maxMinutes']:g}분 / 차이 {row['spreadMinutes']:g}분 / 합계 {row['totalMinutes']:g}분" + suffix)
        elif mode == 'fast':
            row['reasonCode'] = 'FAST_TOTAL' if index == 0 else 'FAST_ALTERNATIVE'
            label = '합계 우선 1위' if index == 0 else '빠른 만남 대안'
            row['reason'] = f"합계 {row['totalMinutes']:g}분, {label} · 최장 {row['maxMinutes']:g}분" + suffix
        else:
            row['reasonCode'] = 'FAVOR_CAPPED' if index == 0 else 'FAVOR_ALTERNATIVE'
            limits = ', '.join(f'{p} {cap:g}분' for p, cap in caps.items())
            row['reason'] = f"{participants[target]} 우선 {row['favoredMinutes']:g}분 · 다른 사람 상한 준수 ({limits})" + suffix
    return {'status': 'ok' if ordered else 'no_common_candidate', 'mode': mode,
            'toleranceMinutes': tolerance, 'participants': participants,
            'baselineStationId': baseline['stationId'] if baseline else None,
            'favorCaps': caps, 'recommendations': ordered,
            'excluded': sorted(excluded, key=lambda row: row['stationId'])}


def toy_network():
    lines = {'red': ['R1', 'R2', 'X', 'R4', 'Y', 'R6', 'R7'],
             'blue': ['B1', 'B2', 'X', 'B4', 'Z', 'B6', 'B7'],
             'green': ['G1', 'G2', 'Y', 'G4', 'Z', 'G6', 'G7']}
    ride = {'red': 5, 'blue': 6, 'green': 6}
    graph = {}
    for line, stations in lines.items():
        for station in stations:
            graph[(station, line)] = []
        for a, b in zip(stations, stations[1:]):
            graph[(a, line)].append(((b, line), ride[line], 0))
            graph[(b, line)].append(((a, line), ride[line], 0))
    stations = sorted({station for station, line in graph})
    for station in stations:
        nodes = [node for node in graph if node[0] == station]
        for a in nodes:
            for b in nodes:
                if a != b:
                    graph[a].append((b, 4, 1))  # 환승 보행 4분, 환승 1회
    return {'stations': stations, 'lines': lines, 'graph': graph}


def shortest_paths(network, origin):
    # 출발역은 모든 노선 승강장에서 시작 가능: 최초 승차는 환승이 아니다.
    graph = network['graph']
    distances = {node: (0, 0) for node in graph if node[0] == origin}
    heap = [(0, 0, node) for node in distances]
    heapq.heapify(heap)
    while heap:
        minutes, transfers, node = heapq.heappop(heap)
        if distances[node] != (minutes, transfers):
            continue
        for next_node, ride, change in graph[node]:
            cost = minutes + ride, transfers + change
            if cost < distances.get(next_node, (math.inf, math.inf)):
                distances[next_node] = cost
                heapq.heappush(heap, (*cost, next_node))
    return {station: min((cost for node, cost in distances.items() if node[0] == station),
                         default=(None, None)) for station in network['stations']}


def matrices(network, origins, candidates):
    if any(station not in network['stations'] for station in origins + candidates):
        raise ValueError('노선도에 없는 역입니다')
    times, transfers = [], []
    for origin in origins:
        distances = shortest_paths(network, origin)
        times.append([distances[c][0] for c in candidates])
        transfers.append([distances[c][1] for c in candidates])
    return {'times': times, 'transfers': transfers}


def main():
    network = toy_network()
    # N개 출발역 × 모든 역의 사전 계산을 먼저 수행한다.
    all_pairs = matrices(network, network['stations'], network['stations'])
    print(f"장난감 노선도: {len(network['lines'])}개 노선 / {len(network['stations'])}개 역 / {len(all_pairs['times'])}×{len(all_pairs['times'])} 행렬")
    participants, origins = ['A', 'B'], ['R1', 'B7']
    candidates = ['X', 'Y', 'Z', 'R4', 'B4', 'G4']
    station_indices = {station: i for i, station in enumerate(network['stations'])}
    data = {name: [[all_pairs[name][station_indices[o]][station_indices[c]]
                    for c in candidates] for o in origins]
            for name in ['times', 'transfers']}
    print('출발역:', dict(zip(participants, origins)))
    print('시간 행렬:', json.dumps(data['times']))
    print('환승 행렬:', json.dumps(data['transfers']))
    for mode in ['fair', 'fast', 'favor:A', 'favor:B']:
        result = recommend(participants, candidates, **data, mode=mode)
        print(f"\n[{mode}] (기준역 {result['baselineStationId']}, 상한 {result['favorCaps']})")
        for row in result['recommendations'][:3]:
            print(f"{row['rank']}. {row['stationId']} 시간={row['times']} 환승={row['transfers']} — {row['reason']}")
    cases = json.loads(Path(__file__).with_name('scenarios.json').read_text())
    for case in cases:
        result = recommend(**case['input'])['recommendations'][0]
        assert result['stationId'] == case['expectedFirst'], case['id']
        assert case['expectedReasonContains'] in result['reason'], case['id']
    print(f'\n골든 시나리오: {len(cases)}/{len(cases)} 통과')


if __name__ == '__main__':
    main()
