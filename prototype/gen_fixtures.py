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


def main(argv):
    files = build_files()
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
        (FIXTURES_DIR / name).write_bytes(payload)
        print(f'{name}: {len(payload)} bytes')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
