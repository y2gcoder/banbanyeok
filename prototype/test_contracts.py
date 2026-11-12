"""contracts/ 파일이 오라클 결과·프라이버시 규칙과 어긋나지 않는지 확인한다. 외부 의존성 없음."""
import json
import unittest
from pathlib import Path

import gen_expected
import gen_fixtures
import gen_link_vectors

CONTRACTS = Path(__file__).resolve().parent.parent / 'contracts'


class GoldenSnapshotTests(unittest.TestCase):
    def test_snapshot_is_reproduced_by_oracle(self):
        self.assertEqual(gen_expected.EXPECTED_PATH.read_text(encoding='utf-8'),
                         gen_expected.render(gen_expected.build_snapshot()),
                         'expected.ranking.json이 오라클과 다릅니다: prototype/gen_expected.py를 실행해 diff를 검토하세요')

    def test_snapshot_first_rank_matches_scenario_expectation(self):
        scenarios = json.loads(gen_expected.SCENARIOS_PATH.read_text(encoding='utf-8'))
        snapshot = json.loads(gen_expected.EXPECTED_PATH.read_text(encoding='utf-8'))['scenarios']
        self.assertEqual([c['id'] for c in scenarios], [s['id'] for s in snapshot])
        for case, snap in zip(scenarios, snapshot):
            with self.subTest(case=case['id']):
                self.assertEqual(case['expectedFirst'], snap['ranking'][0]['stationId'])
                self.assertEqual([i + 1 for i in range(len(snap['ranking']))], [r['rank'] for r in snap['ranking']])


class LinkVectorTests(unittest.TestCase):
    def test_vectors_are_reproduced_by_reference_implementation(self):
        self.assertEqual(gen_link_vectors.VECTORS_PATH.read_text(encoding='utf-8'),
                         gen_link_vectors.render(gen_link_vectors.build_vectors()),
                         'link-vectors.json이 기준 구현과 다릅니다: prototype/gen_link_vectors.py를 실행하세요')

    def test_vectors_cover_every_error_code(self):
        vectors = json.loads(gen_link_vectors.VECTORS_PATH.read_text(encoding='utf-8'))
        errors = {v['expectedError'] for v in vectors['decode'] if 'expectedError' in v}
        self.assertEqual({'MISSING_PARAM', 'UNSUPPORTED_VERSION', 'BAD_ORIGIN_COUNT', 'BAD_STATION_CODE', 'BAD_MODE',
                          'FAVOR_INDEX_OUT_OF_RANGE', 'DUPLICATE_PARAM', 'BAD_NICKNAMES', 'MALFORMED_QUERY'}, errors)

    def test_canonical_decode_reencodes_to_same_query(self):
        vectors = json.loads(gen_link_vectors.VECTORS_PATH.read_text(encoding='utf-8'))
        for item in vectors['encode']:
            with self.subTest(item=item['id']):
                decoded = gen_link_vectors.decode_query(item['expectedQuery'])
                again = gen_link_vectors.encode_query(decoded['origins'], decoded['mode'], decoded['favorIndex'],
                                                      decoded['nicknames'])
                self.assertEqual(item['expectedQuery'], again)

    def test_nickname_separator_is_dot_and_encoded_queries_are_rfc3986_safe(self):
        vectors = json.loads(gen_link_vectors.VECTORS_PATH.read_text(encoding='utf-8'))
        allowed = set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.=&')
        for item in vectors['encode']:
            with self.subTest(item=item['id']):
                self.assertTrue(set(item['expectedQuery']) <= allowed, item['expectedQuery'])
        nick = [i for i in vectors['encode'] if i['input']['nicknames']]
        self.assertTrue(any('.' in i['expectedQuery'].split('n=')[1] for i in nick))
        self.assertEqual('BAD_NICKNAMES', next(v['expectedError'] for v in vectors['decode']
                                               if v['id'] == 'nickname_pipe_separator_rejected'))


class FixtureTests(unittest.TestCase):
    def test_fixtures_are_reproduced(self):
        for name, payload in gen_fixtures.build_files().items():
            with self.subTest(file=name):
                self.assertEqual((gen_fixtures.FIXTURES_DIR / name).read_bytes(), payload,
                                 'prototype/gen_fixtures.py를 실행해 픽스처를 다시 만드세요')

    def test_manifest_hashes_match_files(self):
        manifest = json.loads((gen_fixtures.FIXTURES_DIR / 'manifest.sample.json').read_text(encoding='utf-8'))
        names = {'registry': 'stations.sample.json', 'candidates': 'candidates.sample.json', 'od': 'od.sample.bin'}
        for key, name in names.items():
            data = (gen_fixtures.FIXTURES_DIR / name).read_bytes()
            entry = manifest['files'][key]
            self.assertEqual(gen_fixtures.sha256_hex(data), entry['sha256'])
            self.assertEqual(len(data), entry['bytes'])
            self.assertIn(entry['sha256'][:16], entry['path'])

    def test_station_codes_are_canonical_and_sorted(self):
        stations = json.loads((gen_fixtures.FIXTURES_DIR / 'stations.sample.json').read_text(encoding='utf-8'))['stations']
        codes = [s['code'] for s in stations]
        self.assertEqual(sorted(codes), codes)
        self.assertEqual(len(set(codes)), len(codes))
        for code in codes:
            self.assertEqual(3, len(code))
            self.assertTrue(all(ch in gen_fixtures.ALPHABET for ch in code), code)


class EventsPrivacyTests(unittest.TestCase):
    def setUp(self):
        self.doc = json.loads((CONTRACTS / 'events.json').read_text(encoding='utf-8'))

    def properties(self):
        for prop in self.doc['commonProperties']:
            yield '(common)', prop
        for event in self.doc['events']:
            for prop in event['properties']:
                yield event['name'], prop

    def test_no_origin_or_identity_properties(self):
        forbidden = set(self.doc['privacy']['forbiddenPropertyNames'])
        fragments = self.doc['privacy']['forbiddenNameFragments']
        for event, prop in self.properties():
            with self.subTest(event=event, prop=prop['name']):
                self.assertNotIn(prop['name'], forbidden)
                self.assertFalse(any(f in prop['name'] for f in fragments))

    def test_event_shapes(self):
        names = [e['name'] for e in self.doc['events']]
        self.assertEqual(len(names), len(set(names)))
        for event in self.doc['events']:
            self.assertIn(event['source'], ('client', 'server', 'client_or_server'))
            props = [p['name'] for p in event['properties']]
            self.assertEqual(len(props), len(set(props)), event['name'])
            for prop in event['properties']:
                self.assertIn(prop['type'], ('string', 'integer', 'boolean', 'enum'))
                self.assertEqual(prop['type'] == 'enum', 'enum' in prop, f"{event['name']}.{prop['name']}")


class OpenApiSmokeTests(unittest.TestCase):
    """YAML 파서가 표준 라이브러리에 없으므로 경로·보안 규칙만 텍스트로 확인한다."""

    def test_documented_paths_exist(self):
        text = (CONTRACTS / 'openapi.yaml').read_text(encoding='utf-8')
        self.assertIn('openapi: 3.1.0', text)
        # servers.url이 /v1 이므로 경로에는 접두어가 없다
        for path in ['/anon', '/rooms', '/rooms/{roomId}', '/rooms/{roomId}/participants',
                     '/rooms/{roomId}/participants/{participantId}', '/rooms/{roomId}/result',
                     '/rooms/{roomId}/outcome', '/recommend', '/manifest', '/data/{version}/{file}']:
            with self.subTest(path=path):
                self.assertIn(f'\n  {path}:\n', text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
