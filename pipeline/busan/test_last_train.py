import unittest

from last_train import day_fraction, h1_directs, h1_trains, k2_trains, latest, table_checks, tago_directs, verdict
from sources import sha256
from timetable import DAY_SECONDS

H23 = 23 * 3600


def fraction(seconds):
    return repr(seconds / DAY_SECONDS)


class BusanLastTrainTest(unittest.TestCase):
    def test_times_after_midnight_stay_on_the_service_day(self):
        self.assertEqual(day_fraction(fraction(H23)), H23)
        self.assertEqual(day_fraction(fraction(1800)), DAY_SECONDS + 1800)
        self.assertEqual(day_fraction(repr(1 + 25 / DAY_SECONDS)), DAY_SECONDS + 25)
        self.assertIsNone(day_fraction("        "))

    def test_h1_reads_each_side_by_side_block_on_its_own(self):
        codes = {"S2601": {"노포": "n01", "범어사": "n02", "남산": "n03"}}
        sheet = [
            ["열차번호", "노포", "범어사", "남산", "열번", "남산", "범어사", "노포", "양산중앙"],
            ["", "", "", "", "1002", fraction(H23), fraction(H23 + 120), fraction(H23 + 240), ""],
            ["1001", fraction(H23), fraction(H23 + 100), "", "", "", "", "", ""],
        ]
        trains = h1_trains({"1호선 평(1회)": sheet, "1호선 역정보": [["x"]]}, codes, ["S2601 양산중앙"])
        self.assertEqual(trains["S2601", "평"], [[("n03", H23), ("n02", H23 + 120), ("n01", H23 + 240)],
                                                [("n01", H23), ("n02", H23 + 100)]])
        beyond = [["열차번호", "남산", "노포", "양산중앙"], ["1003", fraction(H23), fraction(H23 + 60), fraction(H23 + 90)]]
        ends = h1_directs(h1_trains({"1호선 평(1회)": beyond}, codes, ["S2601 양산중앙"])["S2601", "평"])
        self.assertEqual(ends["n03", "n01"], (H23, "?양산중앙", True), "a train past the last mapped stop keeps its end")
        self.assertEqual(verdict((H23, "n01", False), (H23, "?양산중앙", False), True), "differs")
        with self.assertRaisesRegex(ValueError, "absent from M1"):
            h1_trains({"1호선 평(1회)": [["열차번호", "서면"], ["1001", fraction(H23)]]}, codes, [])

    def test_k2_reads_arrival_and_departure_rows_per_train_column(self):
        codes = {"부전": "d01", "교대": "d02", "태화강": "d03"}
        sheet = [
            ["조정안"], ["시발역", "부전", "부전"], ["종착역", "태화강", "교대"], ["열차번호", "K1", "K3"],
            ["부전", "        ", "        "], ["", fraction(H23), fraction(H23 + 600)],
            ["부교대", fraction(H23 + 300), fraction(H23 + 900)], ["", fraction(H23 + 330), ""],
            ["태화강", fraction(H23 + 3000), "        "], ["", "", ""],
        ]
        trains = k2_trains({"평일 하행": sheet}, codes)
        self.assertEqual(trains["평일"], [
            [("d01", None, H23), ("d02", H23 + 300, H23 + 330), ("d03", H23 + 3000, None)],
            [("d01", None, H23 + 600), ("d02", H23 + 900, None)],
        ])

    def test_verdicts_compare_minutes_for_numbered_lines_and_seconds_for_tago(self):
        b1 = (H23 + 60, "n03", False)
        self.assertEqual(verdict(b1, (H23 + 119, "n03", False), True), "agree")
        self.assertEqual(verdict(b1, (H23 + 120, "n03", False), True), "differs")
        self.assertEqual(verdict(b1, (H23 + 60, "n04", False), True), "differs")
        self.assertEqual(verdict(b1, (H23 + 60, "n03", True), True), "origin")
        self.assertEqual(verdict(b1, (H23 + 61, "n03", False), False), "differs")
        self.assertEqual(verdict(b1, (H23 + 60, "n03", True), False), "origin", "a 동해선 train K2 starts at S")
        self.assertEqual(verdict(b1, None, True), "missing")
        self.assertEqual(verdict("ambiguous", b1, True), "ambiguous")

    def test_latest_is_ambiguous_only_when_tied_trains_disagree(self):
        self.assertEqual(latest([(1, "a"), (2, "b"), (2, "b")]), "b")
        self.assertEqual(latest([(2, "a"), (2, "b")]), "ambiguous")

    def test_tago_takes_the_last_departure_whose_terminus_reaches_home(self):
        order = ["d01", "d02", "d03", "d04"]
        rows = {"d02": {(H23, "d04"), (H23 + 600, "d03"), (H23 + 900, "d01")}}
        directs = tago_directs(rows, order)
        self.assertEqual(directs["d02", "d04"], (H23, "d04", False))
        self.assertEqual(directs["d02", "d03"], (H23 + 600, "d03", False))
        self.assertEqual(directs["d02", "d01"], (H23 + 900, "d01", False))

    def test_each_table_hashes_only_its_own_rows(self):
        header = "day,line,meeting,home,time,destination,check\n"
        k2_row = "weekday,L2,a02,a03,23:45:30,a03,agree\n"
        h1_rows = "weekday,L1,a01,a02,23:24:10,a02,agree\nweekday,L1,a02,a01,,,missing\n"
        text = header + k2_row + h1_rows
        self.assertEqual(table_checks(text, ["L1"]), header + h1_rows)
        self.assertEqual(table_checks(text, ["L2"]), header + k2_row)
        # BusanLastTrainTest.kt pins the same two digests, so both sides cut the file alike.
        self.assertEqual(sha256(table_checks(text, ["L1"]).encode()),
                         "ba2c16c93f6f44fac0c61281804148412f20bff692a857183db908276c6da6dd")
        self.assertEqual(sha256(table_checks(text, ["L2"]).encode()),
                         "2658fc87e16307cd85a9b83fb9f6498c9ede9dd35ad847204adf79eceead43ad")
        changed = text.replace("23:24:10,a02,agree", "23:24:10,a02,differs")
        self.assertNotEqual(table_checks(changed, ["L1"]), table_checks(text, ["L1"]))
        self.assertEqual(table_checks(changed, ["L2"]), table_checks(text, ["L2"]), "an H1 row leaves K2's rows")


if __name__ == "__main__":
    unittest.main()
