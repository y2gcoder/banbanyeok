"""contracts/fixtures/ 샘플 산출물(레지스트리·후보·od.bin·manifest)을 만든다.

장난감 노선도(prototype/algorithm.py의 toy_network)에서 출발해 contracts/data-format.md의 형식대로 쓴다.
Kotlin(shared/schema)의 reader/writer와는 **독립 구현**이다. Kotlin 테스트가 이 파일을 읽고 다시 써서
바이트가 같은지 비교하므로, 두 구현이 같은 형식을 말하는지 확인하는 교차 검증이 된다.

사용:
  python3 -B prototype/gen_fixtures.py          # 파일을 (재)생성한다
  python3 -B prototype/gen_fixtures.py --check  # 현재 파일이 생성 결과와 같은지만 확인한다(CI용)
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

from algorithm import matrices, toy_network

FIXTURES_DIR = Path(__file__).resolve().parent.parent / 'contracts' / 'fixtures'

ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'  # Crockford base32 소문자: i, l, o, u 제외
FORMAT_VERSION = 1
REGISTRY_VERSION = 1
DATA_VERSION = '20261112.1'
GENERATED_AT = '2026-11-12T00:00:00Z'
CANDIDATES = ['X', 'Y', 'Z', 'R4', 'B4', 'G4']

OD_MAGIC = b'BBOD'
OD_HEADER_SIZE = 32
TIME_UNREACHABLE = 0xFFFF
TRANSFER_UNREACHABLE = 0xFF


def encode_code(value):
    if not 0 <= value < 32768:
        raise ValueError('역 코드 값은 0..32767')
    return ALPHABET[(value >> 10) & 31] + ALPHABET[(value >> 5) & 31] + ALPHABET[value & 31]


def station_value(index):
    """픽스처 전용: 임의지만 결정적인 코드 값. 997은 32768과 서로소라 18개가 겹치지 않는다."""
    return (index * 997 + 123) % 32768


def encode_od(registry_version, origin_values, candidate_values, times_sec, transfers):
    """od.bin 인코딩. 시간 u16 초(0xFFFF=도달 불가), 환승 u8(0xFF=도달 불가), 리틀 엔디언."""
    n, m = len(origin_values), len(candidate_values)
    if origin_values != sorted(set(origin_values)) or candidate_values != sorted(set(candidate_values)):
        raise ValueError('코드는 오름차순·중복 없음')
    out = bytearray()
    out += OD_MAGIC
    out += struct.pack('<HH', FORMAT_VERSION, OD_HEADER_SIZE)
    out += struct.pack('<I', 0)                # flags
    out += struct.pack('<I', registry_version)
    out += struct.pack('<II', n, m)
    out += struct.pack('<Q', 0)                # reserved
    assert len(out) == OD_HEADER_SIZE
    out += struct.pack(f'<{n}H', *origin_values)
    out += struct.pack(f'<{m}H', *candidate_values)
    for row in times_sec:
        out += struct.pack(f'<{m}H', *[TIME_UNREACHABLE if t is None else t for t in row])
    for row in transfers:
        out += struct.pack(f'<{m}B', *[TRANSFER_UNREACHABLE if x is None else x for x in row])
    return bytes(out)


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2) + '\n'


def build_files():
    network = toy_network()
    names = network['stations']  # 이름순(코드포인트) 정렬
    values = {name: station_value(i) for i, name in enumerate(names)}
    lines_of = {name: [line for line, stops in network['lines'].items() if name in stops] for name in names}

    ordered = sorted(names, key=lambda name: values[name])  # 코드 오름차순 = 문자열 오름차순
    stations = []
    for i, name in enumerate(ordered):
        stations.append({
            'code': encode_code(values[name]),
            'name': name,
            'status': 'active',
            'lat': round(37.5 + 0.01 * (names.index(name) // 6), 6),
            'lng': round(127.0 + 0.01 * (names.index(name) % 6), 6),
            'lines': lines_of[name],
            'aliases': [],
            'sources': {'fixture': name},
            'addedIn': 1,
        })
    registry = {'schemaVersion': FORMAT_VERSION, 'registryVersion': REGISTRY_VERSION, 'stations': stations}
    candidate_values = sorted(values[c] for c in CANDIDATES)
    candidates = {'schemaVersion': FORMAT_VERSION, 'registryVersion': REGISTRY_VERSION,
                  'candidates': [encode_code(v) for v in candidate_values]}

    by_value = {v: name for name, v in values.items()}
    origin_values = sorted(values.values())
    data = matrices(network, [by_value[v] for v in origin_values], [by_value[v] for v in candidate_values])
    times_sec = [[None if t is None else t * 60 for t in row] for row in data['times']]
    od = encode_od(REGISTRY_VERSION, origin_values, candidate_values, times_sec, data['transfers'])

    registry_bytes = dump(registry).encode('utf-8')
    candidates_bytes = dump(candidates).encode('utf-8')

    def entry(prefix, ext, payload):
        digest = sha256_hex(payload)
        return {'path': f'versions/{DATA_VERSION}/{prefix}.{digest[:16]}.{ext}', 'sha256': digest, 'bytes': len(payload)}

    manifest = {
        'schemaVersion': FORMAT_VERSION,
        'minClientSchema': FORMAT_VERSION,
        'dataVersion': DATA_VERSION,
        'generatedAt': GENERATED_AT,
        'registryVersion': REGISTRY_VERSION,
        'timeModel': 'fixture-v1',
        'originCount': len(origin_values),
        'candidateCount': len(candidate_values),
        'files': {
            'registry': entry('stations', 'json', registry_bytes),
            'candidates': entry('candidates', 'json', candidates_bytes),
            'od': entry('od', 'bin', od),
        },
    }
    return {
        'stations.sample.json': registry_bytes,
        'candidates.sample.json': candidates_bytes,
        'od.sample.bin': od,
        'manifest.sample.json': dump(manifest).encode('utf-8'),
    }


def regional_graph(labels, slots):
    # Two services in Busan meet at 004, while the two capital stations form a separate component.
    nodes = [(1, 0), (2, 0), (3, 1), (4, 1), (4, 2), (5, 2)]
    edges = [
        [(1, 60, 0xFF)], [(0, 60, 0xFF)], [(3, 60, 0xFF)],
        [(2, 60, 0xFF), (4, 89, 2)], [(3, 89, 1), (5, 60, 0xFF)], [(4, 60, 0xFF)],
    ]
    starts = [0]
    for outgoing in edges:
        starts.append(starts[-1] + len(outgoing))
    graph = bytearray(b'BBRG')
    graph += struct.pack('<HHIIIIHHHH', 2, 32, 0, REGISTRY_VERSION, len(nodes), starts[-1],
                         len(labels), len(labels), len(slots), 0)
    for label in labels:
        name = label.encode('utf-8')
        graph += bytes([len(name)]) + name
    graph += bytes(range(len(labels)))
    for code, service in nodes:
        graph += struct.pack('<HB', code, service)
    graph += struct.pack(f'<{len(starts)}I', *starts)
    for outgoing in edges:
        for target, seconds, service in outgoing:
            graph += struct.pack('<HHB', target, seconds, service)
    for slot in slots:
        graph += struct.pack('<3H', 60, 60, 0xFFFF if slot.startswith('saturday-') else 90)
    return bytes(graph)


def build_regional_files():
    version = '20261126.1'
    slots_contract = json.loads((FIXTURES_DIR.parent / 'time-slots.json').read_text(encoding='utf-8'))
    slots = [f"{day['id']}-{band['id']}" for day in slots_contract['dayTypes'] for band in slots_contract['bands']]
    default_slot = slots_contract['default']
    origins = [1, 2, 3, 4, 5]
    candidates = [2, 4]
    labels = ['2호선', '부산1호선', '동해선']
    stations = []
    for code, name, region, lines in [
        (1, '서울가', 'capital', [labels[0]]),
        (2, '교대', 'capital', [labels[0]]),
        (3, '교대', 'busan', [labels[1]]),
        (4, '부산가', 'busan', labels[1:]),
        (5, '부산나', 'busan', [labels[2]]),
    ]:
        stations.append({
            'code': encode_code(code), 'name': name, 'status': 'active', 'lat': 37.5 if region == 'capital' else 35.0,
            'lng': 127.0 if region == 'capital' else 129.0, 'lines': lines, 'aliases': [],
            'sources': {'fixture': encode_code(code)}, 'addedIn': REGISTRY_VERSION, 'region': region,
        })
    files = {}

    def add(name, payload):
        digest = sha256_hex(payload)
        stem, extension = name.rsplit('.', 1)
        filename = f'{stem}.{digest[:16]}.{extension}'
        path = f'regional/versions/{version}/{filename}'
        files[path] = payload
        return {'path': path, 'sha256': digest, 'bytes': len(payload)}

    def od(saturday):
        rows = [[120, None], [0, None], [None, 120], [None, 0], [None, None if saturday else 150]]
        transfers = [[0 if seconds is not None else None for seconds in row] for row in rows]
        return encode_od(REGISTRY_VERSION, origins, candidates, rows, transfers)

    registry = {'schemaVersion': 2, 'registryVersion': REGISTRY_VERSION, 'stations': stations}
    choices = {'schemaVersion': 1, 'registryVersion': REGISTRY_VERSION,
               'candidates': [encode_code(code) for code in candidates]}
    regular_od = add('od.bin', od(False))
    saturday_od = add('od-saturday.bin', od(True))
    cells_per_day = len(origins) * len(candidates)
    unknown_day = b'\xff\xff' * cells_per_day + bytes(cells_per_day) + b'\xff\xff' * cells_per_day
    lt = (b'BBLT' + struct.pack('<HHIIIIQ', 1, 32, 0, REGISTRY_VERSION, len(origins), len(candidates), 0)
          + struct.pack(f'<{len(origins) + len(candidates)}H', *(origins + candidates)) + unknown_day * 3)
    complete = {'available': True, 'missingServices': [], 'unsupportedOrigins': []}
    partial = {'available': True, 'missingServices': ['동해선'], 'unsupportedOrigins': ['005']}
    manifest = {
        'schemaVersion': 5, 'minClientSchema': 5, 'dataVersion': version, 'generatedAt': '2026-11-26T00:00:00Z',
        'registryVersion': REGISTRY_VERSION, 'timeModel': 'regional-fixture', 'originCount': len(origins),
        'candidateCount': len(candidates),
        'files': {
            'registry': add('stations.json', dump(registry).encode('utf-8')),
            'candidates': add('candidates.json', dump(choices).encode('utf-8')),
            'od': regular_od,
            'odSlots': {slot: saturday_od if slot.startswith('saturday-') else regular_od
                        for slot in slots if slot != default_slot},
            'lastTrain': add('lt.bin', lt),
            'routeGraph': add('rg.bin', regional_graph(labels, slots)),
        },
        'lastTrainAsOf': '2026-11-26', 'lastTrainModel': 'regional-fixture',
        'regionCoverage': {
            region: {
                slot: partial if region == 'busan' and slot.startswith('saturday-') else complete
                for slot in slots
            } for region in ['capital', 'busan']
        },
    }
    files['regional/manifest.v5.json'] = dump(manifest).encode('utf-8')
    return files


def main(argv):
    files = build_files() | build_regional_files()
    if '--check' in argv:
        stale = [name for name, payload in files.items()
                 if not (FIXTURES_DIR / name).exists() or (FIXTURES_DIR / name).read_bytes() != payload]
        if stale:
            print('최신이 아닌 픽스처:', ', '.join(stale), file=sys.stderr)
            return 1
        print('fixtures: 최신')
        return 0
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    for name, payload in files.items():
        path = FIXTURES_DIR / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        print(f'{name}: {len(payload)} bytes')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
