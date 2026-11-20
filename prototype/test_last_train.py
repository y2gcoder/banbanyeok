"""막차 오라클(prototype/last_train.py)과 장난감 픽스처의 기대 칸이 어긋나지 않는지 확인한다. 외부 의존성 없음."""
import json
import unittest
from pathlib import Path

import last_train

FIXTURES = Path(__file__).resolve().parent.parent / 'pipeline/src/test/resources/last-train'


class ToyNetworkTests(unittest.TestCase):
    def setUp(self):
        self.expected = last_train.expect(FIXTURES / 'toy.json')
        self.cells = {day: {(home, meeting): (kind, minute, bound) for home, meeting, kind, minute, bound in cells}
                      for day, cells in self.expected.items()}

    def test_expected_file_is_reproduced_by_the_oracle(self):
        self.assertEqual((FIXTURES / 'toy.expected.json').read_text(encoding='utf-8'), last_train.render(self.expected),
                         'toy.expected.json이 오라클과 다릅니다: prototype/last_train.py expect로 다시 만들고 diff를 검토하세요')

    def test_rows_without_an_arrival_are_not_stops(self):
        weekday = self.cells['weekday']
        # 23:30 급행은 x02를 지나기만 한다(도착 시각 없는 줄). x02까지의 막차는 23:45 열차이고 그 열차는 x04까지만 간다.
        self.assertEqual((last_train.DIRECT, 23 * 60 + 45, 'x04'), weekday['x02', 'x01'])
        # 23:54:30에 t00을 지나는 열차는 앞 역 줄과 이어지지 않았어도 탈 수 없다. t00에서 x04로 가는 막차는 24:10에 출발하는 열차다.
        self.assertEqual((last_train.DIRECT, 24 * 60 + 10, 'x06'), weekday['x04', 't00'])

    def test_a_transfer_wins_only_when_its_shown_time_is_later(self):
        # x01 -> x06: 직행 막차는 23:30(급행), 갈아타면 23:45. 10분 단위로 내린 23:40이 23:30보다 늦다.
        self.assertEqual((last_train.MARGIN_TRANSFER, 23 * 60 + 45, None), self.cells['weekday']['x06', 'x01'])

    def test_the_allowance_depends_on_the_direction_of_the_change(self):
        weekday = self.cells['weekday']
        # N -> X는 걷는 시간 120초(여유 10분): 23:14:30 도착, 23:26 출발 열차를 탄다.
        self.assertEqual((last_train.MARGIN_TRANSFER, 23 * 60 + 10, None), weekday['x01', 'n01'])
        # X -> N은 200초(여유 11분 40초): 23:03:30 도착으로는 23:15 열차를 못 탄다. n05까지 가는 길이 없다.
        self.assertNotIn(('n05', 'x01'), weekday)

    def test_through_trains_cross_the_two_sources(self):
        # 번호 있는 구간(n01~n03)과 번호 없는 구간(n03~n05)이 한 열차로 이어진다.
        self.assertEqual((last_train.MARGIN_DIRECT, 23 * 60 + 10, 'n05'), self.cells['weekday']['n05', 'n01'])

    def test_exact_minutes_only_on_days_the_family_is_confirmed(self):
        self.assertEqual(last_train.DIRECT, self.cells['weekday']['x02', 'x01'][0])
        self.assertEqual(last_train.MARGIN_DIRECT, self.cells['holiday']['x02', 'x01'][0])
        self.assertEqual({}, self.cells['saturday'])

    def test_a_numbered_line_is_exact_only_on_days_it_matched_the_operators_file(self):
        # N선은 평일에만 공식 파일 대조를 통과했다(exactNumbered): n01 23:50 열차는 평일엔 분 그대로, 휴일엔 3분 여유를 둔다.
        self.assertEqual((last_train.DIRECT, 23 * 60 + 50, 'n03'), self.cells['weekday']['n02', 'n01'])
        self.assertEqual((last_train.MARGIN_DIRECT, 23 * 60 + 47, 'n03'), self.cells['holiday']['n02', 'n01'])
        # 타는 역은 확정 구간이어도 내리는 역(n04)이 번호 없는 줄로 이은 구간이면 확정이 아니다.
        self.assertEqual((last_train.MARGIN_DIRECT, 23 * 60 + 10, 'n05'), self.cells['weekday']['n04', 'n01'])

    def test_an_uncompared_source_is_boarded_three_minutes_early(self):
        # 휴일의 X선은 번호 없는 줄로 다시 이은 열차이고 그날은 확정 노선이 아니다: 23:00 열차는 22:57로 낸다.
        self.assertEqual((last_train.MARGIN_DIRECT, 22 * 60 + 57, 'x06'), self.cells['holiday']['t00', 'x01'])
        # 평일은 공식표 대조를 통과한 날이라 분 그대로다.
        self.assertEqual(23 * 60 + 45, self.cells['weekday']['x02', 'x01'][1])

    def test_the_earlier_answer_of_two_sources_is_kept(self):
        holiday = self.cells['holiday']
        # 둘째 원천은 x01행을 10분 일찍 운행한다(t00 23:16): 이른 쪽을 쓴다.
        self.assertEqual((last_train.MARGIN_DIRECT, 23 * 60 + 16, 'x01'), holiday['x01', 't00'])
        # 둘째 원천에만 있는 더 늦은 열차(23:40)는 쓰지 않는다.
        self.assertEqual(22 * 60 + 57, holiday['x02', 'x01'][1])

    def test_an_express_is_not_joined_to_the_local_it_overtakes(self):
        # PR #81 검토의 반례: 완행은 b에서 23:02~23:12 대기, 급행은 a 23:10 출발로 b·c를 통과한다. a→c의 참값은 완행 23:00이고
        # 틀린 답은 23:10이었다. 완행이 c에 닿는 줄(23:14)은 b를 23:11에 지난 급행도 90초 안에서 자기 것이라 할 수 있어 잇지 않는다:
        # 시각을 내지 않는다(이른 쪽).
        cells = last_train.expect(FIXTURES / 'overtake.json')
        self.assertEqual([], cells['weekday'])

    def test_an_express_is_not_joined_to_the_train_starting_where_it_passes(self):
        # 둘째 검토의 반례: 급행 a 23:14, b에서 시작하는 완행 23:16(c 정차), 급행의 b 통과 줄 23:17:10. 두 줄 모두 예상 시각
        # 90초 안이다. 가까운 쪽을 고르면 급행에 완행이 붙어 a→c가 23:11이 된다. 참값은 23:00(여유 3분을 빼 22:57).
        cells = last_train.expect(FIXTURES / 'start-and-pass.json')
        self.assertEqual([['c', 'a', last_train.MARGIN_DIRECT, 22 * 60 + 57, 'd']], cells['weekday'])

    def test_a_row_without_an_arrival_is_linked_to_only_when_nothing_else_is_near(self):
        data = json.loads((FIXTURES / 'start-and-pass.json').read_text(encoding='utf-8'))
        problem = last_train.Problem(data)

        def trains(rows):
            return last_train.unnumbered_trains(problem, rows, 'weekday')

        def from_a(found, seconds):
            return [t for t in found if any(stop[0] == 'a' and stop[2] == seconds for stop in t.stops)]

        rows = {station: [tuple(row) for row in found] for station, found in data['rows']['weekday']['unnumbered'].items()}
        self.assertEqual([], from_a(trains(rows), 23 * 3600 + 14 * 60))
        # 급행의 b 통과 줄이 100초 떨어져 후보가 하나뿐이어도, 도착 시각 없는 줄은 시발일 수 있고 5분 안에 다른 줄이 있다.
        moved = dict(rows, b=[row if row != (-1, 83830, 'd') else (-1, 83860, 'd') for row in rows['b']])
        self.assertNotEqual(rows, moved)
        self.assertEqual([], from_a(trains(moved), 23 * 3600 + 14 * 60))
        # b에서 시작하는 완행이 없으면 급행은 다시 한 열차다(a, b·c 통과, d 도착).
        alone = dict(rows, b=[r for r in rows['b'] if r[1] != 83760], c=[r for r in rows['c'] if r[1] != 84000],
                     d=[r for r in rows['d'] if r[0] != 84090])
        express = from_a(trains(alone), 23 * 3600 + 14 * 60)
        self.assertEqual([['a', 'b', 'c', 'd']], [[stop[0] for stop in t.stops] for t in express])

    def test_rows_without_train_numbers_give_no_time_unless_rebuilding_is_on(self):
        # 3차 재검토의 반례 셋: ±90초 안의 유일한 후보가 다른 열차(lone-candidate), 통과 줄을 301초 밖으로 민 것(far-pass),
        # c 종착 뒤 15초에 c에서 출발하는 열차(short-run). 기본(다시 잇기 꺼짐)에서는 모두 시각이 없다.
        for name in ('lone-candidate.json', 'far-pass.json', 'short-run.json'):
            self.assertEqual({'weekday': [], 'saturday': [], 'holiday': []}, last_train.expect(FIXTURES / name), name)
        # 앞선 두 반례는 다시 잇는 규칙을 시험하느라 파일에서 켜 둔다. 끄면 역시 시각이 없다.
        for name in ('overtake.json', 'start-and-pass.json'):
            self.assertEqual([], last_train.expect(FIXTURES / name, rebuild=False)['weekday'], name)

    def test_the_same_rows_with_train_numbers_give_the_real_last_train(self):
        cells = last_train.expect(FIXTURES / 'lone-candidate-numbered.json')
        self.assertEqual([['b', 'a', last_train.MARGIN_DIRECT, 23 * 60 + 9, 'd'],
                          ['c', 'a', last_train.MARGIN_DIRECT, 23 * 60 + 9, 'd']], cells['weekday'])

    def test_rebuilding_would_be_late_on_the_counterexamples(self):
        # 끈 이유: 켜면 세 입력 모두 참 막차(23:09, 23:00, 23:09)보다 늦은 23:11(화면 23:10)이 나온다.
        for name, truth in (('lone-candidate.json', 23 * 60 + 9), ('far-pass.json', 23 * 60), ('short-run.json', 23 * 60 + 9)):
            cells = last_train.expect(FIXTURES / name, rebuild=True)['weekday']
            self.assertTrue(cells and all(last_train.shown(tuple(cell[2:])) > truth for cell in cells), name)

    def test_expected_file_with_rebuilding_off_is_reproduced_by_the_oracle(self):
        expected = last_train.expect(FIXTURES / 'toy.json', rebuild=False)
        self.assertEqual((FIXTURES / 'toy.off.expected.json').read_text(encoding='utf-8'), last_train.render(expected),
                         'toy.off.expected.json이 오라클과 다릅니다: prototype/last_train.py expect-off로 다시 만드세요')
        cells = {day: {(home, meeting): (kind, minute, bound) for home, meeting, kind, minute, bound in found}
                 for day, found in expected.items()}
        # 번호 없는 X선은 운영사 표로 칸마다 대조한 직행 칸(x01→x02 23:45 x04행)만 시각이 있다.
        self.assertEqual((last_train.DIRECT, 23 * 60 + 45, 'x04'), cells['weekday']['x02', 'x01'])
        self.assertNotIn(('x04', 't00'), cells['weekday'])  # 표의 분(24:11)이 다시 이은 열차(24:10)와 다르다
        self.assertNotIn(('x06', 'x01'), cells['weekday'])  # 표의 행선지가 다르다
        self.assertNotIn(('x01', 'n01'), cells['weekday'])  # X선을 지나는 환승
        # 휴일의 X선은 열차 번호가 있는 둘째 원천으로만 낸다(여유 3분). 대조 노선이 아니라 표의 칸은 더해지지 않는다.
        self.assertEqual((last_train.MARGIN_DIRECT, 22 * 60 + 56, 'x06'), cells['holiday']['t00', 'x01'])
        self.assertEqual((last_train.MARGIN_DIRECT, 23 * 60 + 37, 'x02'), cells['holiday']['x02', 'x01'])

    def test_the_operators_file_marks_a_passed_station_with_a_zero_time(self):
        # 4차 검토: 공식 파일은 급행이 지나가기만 하는 역의 도착을 "00:00:00"으로 적는다(자정은 "24:00:00"). 자정으로 읽으면
        # 지나가는 역이 몇 시간 뒤에 "도착"하는 정차역이 된다.
        self.assertEqual(-1, last_train.official_seconds('00:00:00'))
        self.assertEqual(-1, last_train.official_seconds(''))
        self.assertEqual(24 * 3600, last_train.official_seconds('24:00:00'))
        self.assertEqual(24 * 3600 + 330, last_train.official_seconds('00:05:30'))
        self.assertEqual(21 * 3600 + 450, last_train.official_seconds('21:07:30'))
        # 1호선 평일 급행 K1949의 실제 줄(청량리 → 천안). 독산·직산은 통과한다.
        rows = [('청량리', '', '19:15:00'), ('독산', '00:00:00', '20:01:30'), ('수원', '20:27:00', '20:27:30'),
                ('성환', '21:03:30', '21:04:00'), ('직산', '00:00:00', '21:07:30'), ('두정', '21:11:00', '21:11:30'),
                ('천안', '21:15:30', '')]
        stops = [('1', 'K1949', name, last_train.official_seconds(a), last_train.official_seconds(d), '천안')
                 for name, a, d in rows]
        names = [name for name, _a, _d in rows]
        problem = last_train.Problem({
            'homes': sorted(names), 'meetings': ['수원', '직산'], 'stations': {},
            'families': {'1': [[a, b] for a, b in zip(names, names[1:])]},
            'hops': [], 'walks': [], 'stationWalks': {}, 'exact': {}})
        cells = last_train.day_table(problem, 'weekday', {'unnumbered': {}, 'numbered': [], 'second': stops})
        # 수원 20:27:30에서 3분을 뺀 20:24: 정차하는 성환·두정·천안에만 내린다. 통과하는 직산에서는 내리지도 타지도 못한다.
        self.assertEqual({('성환', '수원'), ('두정', '수원'), ('천안', '수원')}, set(cells))
        self.assertEqual({(last_train.MARGIN_DIRECT, 20 * 60 + 24, '천안')}, set(cells.values()))
        # 표식을 자정으로 읽으면(고치기 전) 직산이 24:00 도착 정차역이 되어 수원→직산 20:24가 나왔다.
        wrong = [stop[:3] + (last_train.seconds(a), last_train.seconds(d)) + stop[5:] for stop, (_n, a, d) in zip(stops, rows)]
        late = last_train.day_table(problem, 'weekday', {'unnumbered': {}, 'numbered': [], 'second': wrong})
        self.assertIn(('직산', '수원'), late)

    def test_fixture_lists_rows_for_the_days_it_covers(self):
        data = json.loads((FIXTURES / 'toy.json').read_text(encoding='utf-8'))
        self.assertEqual({'weekday', 'holiday'}, set(data['rows']))


if __name__ == '__main__':
    unittest.main()
