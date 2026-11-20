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

    def test_fixture_lists_rows_for_the_days_it_covers(self):
        data = json.loads((FIXTURES / 'toy.json').read_text(encoding='utf-8'))
        self.assertEqual({'weekday', 'holiday'}, set(data['rows']))


if __name__ == '__main__':
    unittest.main()
