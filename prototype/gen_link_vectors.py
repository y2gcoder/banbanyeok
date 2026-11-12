"""공유 URL(/s) 링크 코덱의 기준 구현과 테스트 벡터(contracts/golden/link-vectors.json) 생성기.

웹(TypeScript), 공유 모듈(Kotlin shared/links), 앱이 각자 링크 코덱을 구현하므로(웹은 KMP를 쓰지 않음)
이 벡터가 언어 간 일치의 기준이다. 규칙은 contracts/data-format.md §7.
이 파일의 encode_query/decode_query가 **기준 구현**이고, 벡터의 expected는 이 구현의 출력이다.

사용:
  python3 -B prototype/gen_link_vectors.py          # 벡터 파일을 (재)생성한다
  python3 -B prototype/gen_link_vectors.py --check  # 파일이 기준 구현의 출력과 같은지 확인한다(CI용)
"""
import base64
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

from gen_fixtures import ALPHABET, encode_code, station_value

VECTORS_PATH = Path(__file__).resolve().parent.parent / 'contracts' / 'golden' / 'link-vectors.json'
URL_VERSION = '1'
MAX_NICKNAME_CODE_POINTS = 20
B64URL = set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_')


class LinkError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _valid_code(text):
    return len(text) == 3 and all(ch in ALPHABET for ch in text)


def _b64url_encode(text):
    return base64.urlsafe_b64encode(text.encode('utf-8')).decode('ascii').rstrip('=')


def _b64url_decode(segment):
    if any(ch not in B64URL for ch in segment) or len(segment) % 4 == 1:
        raise LinkError('BAD_NICKNAMES')
    try:
        raw = base64.urlsafe_b64decode(segment + '=' * (-len(segment) % 4))
        text = raw.decode('utf-8')
    except (ValueError, UnicodeDecodeError):
        raise LinkError('BAD_NICKNAMES')
    if _b64url_encode(text) != segment:  # 비정규 base64(남는 비트가 0이 아님)를 거부한다
        raise LinkError('BAD_NICKNAMES')
    return text


def encode_query(origins, mode, favor_index=None, nicknames=None):
    """정규형 쿼리 문자열(앞의 '?' 없음). 파라미터 순서 v, o, m, n. n은 별칭이 하나도 없으면 생략."""
    if not 2 <= len(origins) <= 4 or not all(_valid_code(c) for c in origins):
        raise ValueError('origins')
    if mode == 'fair':
        m = 'f'
    elif mode == 'fast':
        m = 'q'
    elif mode == 'favor' and favor_index is not None and 0 <= favor_index < len(origins):
        m = f'p{favor_index}'
    else:
        raise ValueError('mode')
    parts = [f'v={URL_VERSION}', f"o={'.'.join(origins)}", f'm={m}']
    if nicknames and any(nicknames):
        if len(nicknames) != len(origins):
            raise ValueError('nicknames')
        for name in nicknames:
            if name and len(name) > MAX_NICKNAME_CODE_POINTS:
                raise ValueError('nickname length')
        parts.append('n=' + '.'.join(_b64url_encode(name or '') for name in nicknames))
    return '&'.join(parts)


def decode_query(query):
    """쿼리 문자열을 해석한다. 알 수 없는 키는 무시. 성공 시 dict, 실패 시 LinkError."""
    values = {}
    for pair in query.split('&') if query else []:
        key, _, raw = pair.partition('=')
        if key not in ('v', 'o', 'm', 'n'):
            continue
        if key in values:
            raise LinkError('DUPLICATE_PARAM')
        if re.search(r'%(?![0-9A-Fa-f]{2})', raw):
            raise LinkError('MALFORMED_QUERY')
        try:
            values[key] = unquote(raw, errors='strict')
        except UnicodeDecodeError:
            raise LinkError('MALFORMED_QUERY')
    for key in ('v', 'o', 'm'):
        if key not in values:
            raise LinkError('MISSING_PARAM')
    if values['v'] != URL_VERSION:
        raise LinkError('UNSUPPORTED_VERSION')
    origins = values['o'].split('.')
    if not 2 <= len(origins) <= 4:
        raise LinkError('BAD_ORIGIN_COUNT')
    if not all(_valid_code(c) for c in origins):
        raise LinkError('BAD_STATION_CODE')
    m = values['m']
    favor_index = None
    if m == 'f':
        mode = 'fair'
    elif m == 'q':
        mode = 'fast'
    elif len(m) == 2 and m[0] == 'p' and m[1] in '0123':
        mode, favor_index = 'favor', int(m[1])
        if favor_index >= len(origins):
            raise LinkError('FAVOR_INDEX_OUT_OF_RANGE')
    else:
        raise LinkError('BAD_MODE')
    nicknames = None
    if 'n' in values:
        segments = values['n'].split('.')
        if len(segments) != len(origins):
            raise LinkError('BAD_NICKNAMES')
        nicknames = []
        for segment in segments:
            text = _b64url_decode(segment) if segment else ''
            if len(text) > MAX_NICKNAME_CODE_POINTS:
                raise LinkError('BAD_NICKNAMES')
            nicknames.append(text or None)
        if not any(nicknames):
            raise LinkError('BAD_NICKNAMES')  # 정규형은 별칭이 하나도 없으면 n을 생략한다
    return {'origins': origins, 'mode': mode, 'favorIndex': favor_index, 'nicknames': nicknames}


def build_vectors():
    c = [encode_code(station_value(i)) for i in range(5)]
    enc = []

    def add_encode(vid, origins, mode, favor_index=None, nicknames=None, note=None):
        item = {'id': vid, 'input': {'origins': origins, 'mode': mode, 'favorIndex': favor_index, 'nicknames': nicknames},
                'expectedQuery': encode_query(origins, mode, favor_index, nicknames)}
        if note:
            item['note'] = note
        enc.append(item)

    add_encode('fair_two', c[:2], 'fair')
    add_encode('fast_three', c[:3], 'fast')
    add_encode('favor_second_of_four', c[:4], 'favor', 1)
    add_encode('same_origin_twice_is_allowed', [c[0], c[0]], 'fair', note='같은 출발역을 두 사람이 입력할 수 있다')
    add_encode('nicknames_korean', c[:2], 'fair', None, ['민수', '지연'])
    add_encode('nicknames_partial', c[:3], 'fast', None, [None, '지연', None], '비어 있는 별칭은 빈 세그먼트')
    add_encode('nickname_ascii_20_max', c[:2], 'fair', None, ['a' * 20, None])
    add_encode('nickname_emoji_20_code_points', c[:2], 'fair', None, ['\U0001F642' * 20, None],
               '길이는 UTF-16 단위가 아니라 코드포인트로 센다(JS의 String.length와 다르다)')
    add_encode('nickname_base64_with_url_chars', c[:2], 'fair', None, ['??>>', 'ÿÿ'], 'base64url의 - 와 _ 가 나오는 입력')

    dec = []

    def add_decode(vid, query, note=None):
        item = {'id': vid, 'query': query}
        try:
            item['expected'] = decode_query(query)
        except LinkError as error:
            item['expectedError'] = error.code
        if note:
            item['note'] = note
        dec.append(item)

    # 정규형 왕복
    for item in enc:
        add_decode('roundtrip_' + item['id'], item['expectedQuery'])
    # 비정규지만 허용되는 입력
    add_decode('param_order_is_free', f'm=f&o={c[0]}.{c[1]}&v=1', '파라미터 순서는 상관없다')
    add_decode('unknown_params_ignored', f'v=1&o={c[0]}.{c[1]}&m=q&utm_source=kakao&x=%ED%95%9C', '알 수 없는 키는 무시한다')
    add_decode('percent_encoded_separator_accepted', f'v=1&o={c[0]}.{c[1]}&m=f&n=66-87IiY%2E7KeA7Jew', '`.`가 %2E로 와도 값을 먼저 퍼센트 디코딩한다')
    add_decode('percent_encoded_dot_accepted', f'v=1&o={c[0]}%2E{c[1]}&m=f')
    # 거부
    add_decode('missing_version', f'o={c[0]}.{c[1]}&m=f')
    add_decode('missing_origins', 'v=1&m=f')
    add_decode('missing_mode', f'v=1&o={c[0]}.{c[1]}')
    add_decode('unsupported_version', f'v=2&o={c[0]}.{c[1]}&m=f')
    add_decode('one_origin', f'v=1&o={c[0]}&m=f')
    add_decode('five_origins', 'v=1&o=' + '.'.join(c[:5]) + '&m=f')
    add_decode('uppercase_code_rejected', f'v=1&o={c[0].upper()}.{c[1]}&m=f', '대문자·혼동 문자 치환은 허용하지 않는다')
    add_decode('confusable_letter_rejected', f'v=1&o=oo0.{c[1]}&m=f', '알파벳에 없는 o')
    add_decode('short_code_rejected', f'v=1&o=ab.{c[1]}&m=f')
    add_decode('empty_origin_segment', f'v=1&o={c[0]}..{c[1]}&m=f')
    add_decode('bad_mode_letter', f'v=1&o={c[0]}.{c[1]}&m=z')
    add_decode('favor_without_index', f'v=1&o={c[0]}.{c[1]}&m=p')
    add_decode('favor_two_digit_index', f'v=1&o={c[0]}.{c[1]}&m=p10')
    add_decode('favor_index_out_of_range', f'v=1&o={c[0]}.{c[1]}&m=p2')
    add_decode('duplicate_param', f'v=1&v=1&o={c[0]}.{c[1]}&m=f')
    add_decode('nickname_count_mismatch', f'v=1&o={c[0]}.{c[1]}&m=f&n=64')
    add_decode('nickname_padding_rejected', f'v=1&o={c[0]}.{c[1]}&m=f&n=7KeA==.7KeA')
    add_decode('nickname_standard_base64_rejected', f'v=1&o={c[0]}.{c[1]}&m=f&n=+/+/.7KeA')
    add_decode('nickname_invalid_utf8', f'v=1&o={c[0]}.{c[1]}&m=f&n=_w.7KeA', '0xFF 한 바이트')
    add_decode('nickname_pipe_separator_rejected', f'v=1&o={c[0]}.{c[1]}&m=f&n=66-87IiY|7KeA7Jew', '옛 구분자 `|`는 더 이상 쓰지 않는다')
    add_decode('nickname_all_empty_not_canonical', f'v=1&o={c[0]}.{c[1]}&m=f&n=.')
    too_long = _b64url_encode('a' * 21)
    add_decode('nickname_21_chars_rejected', f'v=1&o={c[0]}.{c[1]}&m=f&n={too_long}.')
    add_decode('malformed_percent_escape', f'v=1&o={c[0]}.{c[1]}&m=%ZZ')

    return {
        'formatVersion': 1,
        'description': '공유 URL(/s) 링크 코덱 테스트 벡터. 기준 구현은 prototype/gen_link_vectors.py. 직접 고치지 말고 재생성한다. 규칙: contracts/data-format.md §7',
        'path': '/s',
        'encode': enc,
        'decode': dec,
    }


def render(vectors):
    return json.dumps(vectors, ensure_ascii=False, indent=2) + '\n'


def main(argv):
    text = render(build_vectors())
    if '--check' in argv:
        current = VECTORS_PATH.read_text(encoding='utf-8') if VECTORS_PATH.exists() else None
        if current != text:
            print(f'{VECTORS_PATH} 가 기준 구현과 다릅니다. gen_link_vectors.py를 실행해 diff를 검토하세요.', file=sys.stderr)
            return 1
        print('link-vectors.json: 최신')
        return 0
    VECTORS_PATH.write_text(text, encoding='utf-8')
    print(f'{VECTORS_PATH} 작성')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
