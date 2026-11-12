"""골든 시나리오 및 실제 그래프 경로 검증. 외부 의존성 없음."""
import itertools
import json
import unittest

from algorithm import SCENARIOS_PATH, recommend, toy_network, matrices


class AlgorithmTests(unittest.TestCase):
    def test_golden_scenarios(self):
        scenarios = json.loads(SCENARIOS_PATH.read_text(encoding='utf-8'))
        for case in scenarios:
            with self.subTest(case=case['id']):
                result = recommend(**case['input'])
                self.assertEqual(result['recommendations'][0]['stationId'], case['expectedFirst'])
                self.assertIn(case['expectedReasonContains'], result['recommendations'][0]['reason'])

    def test_graph_paths_include_transfer_walk(self):
        network = toy_network()
        data = matrices(network, ['R2', 'X'], ['B2', 'X', 'R7'])
        self.assertEqual(data['times'], [[15, 5, 25], [6, 0, 20]])
        self.assertEqual(data['transfers'], [[1, 0, 0], [0, 0, 0]])
        self.assertEqual(len(network['stations']), 18)

    def test_same_station_different_people(self):
        data = matrices(toy_network(), ['X', 'X'], ['X'])
        result = recommend(['A', 'B'], ['X'], **data)
        self.assertEqual(result['recommendations'][0]['times'], [0, 0])

    def test_no_reachable_candidate(self):
        result = recommend(['A', 'B'], ['X'], [[None], [10]], [[None], [0]])
        self.assertEqual(result['status'], 'no_common_candidate')
        self.assertEqual(result['recommendations'], [])

    def test_input_rejection(self):
        valid = dict(participants=['A', 'B'], candidates=['X'], times=[[20], [30]], transfers=[[0], [0]])
        for patch in [dict(mode='favor:C'), dict(mode='other'), dict(times=[[-1], [30]]),
                      dict(times=[[True], [30]]), dict(transfers=[[0.5], [0]]),
                      dict(times=[[None], [30]]), dict(candidates=['X', 'X']),
                      dict(participants=['A']), dict(tolerance=-1), dict(times=[[float('nan')], [30]])]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                recommend(**(valid | patch))

    def test_tolerance_order_is_input_permutation_independent(self):
        values = {'a': [10, 40], 'b': [40, 42], 'c': [43, 44]}
        orders = []
        for ids in itertools.permutations(values):
            result = recommend(['A', 'B'], list(ids),
                               [[values[c][p] for c in ids] for p in range(2)],
                               [[0] * 3, [0] * 3], tolerance=3)
            orders.append([r['stationId'] for r in result['recommendations']])
        self.assertTrue(all(order == ['b', 'a', 'c'] for order in orders))


if __name__ == '__main__':
    unittest.main(verbosity=2)
