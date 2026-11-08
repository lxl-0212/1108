#!/usr/bin/env python3
from __future__ import annotations
import json, re, sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = BASE / 'data'
REG = DATA / 'regulations'

REGULATIONS = {
    'mobile_device_policy.md': {'title':'生輔組－行動載具管理規則','keywords':['行動載具','手機','平板','載具']},
    'conduct_and_class_order.md': {'title':'生輔組－品德教育暨班級生活秩序競賽實施要點','keywords':['品德','生活秩序','秩序競賽','班級競賽']},
    'student_rewards_discipline.md': {'title':'生輔組－學生獎懲規定','keywords':['獎懲','嘉獎','警告','小過','大過','懲處','銷過']},
    'student_leave_rules.md': {'title':'生輔組－學生請假規則','keywords':['請假','病假','事假','公假','補假','喪假','身心調適假']},
}


def load_json(name):
    p = DATA / name
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else {}


def compact(s):
    return re.sub(r'\s+', '', str(s or '')).lower()


def place_variants(s):
    q = compact(s)
    vals = {q}
    vals.add(re.sub(r'^\d+樓', '', q))
    vals |= {v.replace('資處科', '資處') for v in list(vals)}
    vals |= {v.replace('資料處理科', '資處') for v in list(vals)}
    return {v for v in vals if v}


def room_match(query, row):
    q = compact(query)
    place = compact(row.get('場所', ''))
    building = compact(row.get('大樓', ''))
    if not place:
        return False
    # When a room code is present, match that code first so generic
    # variants like "電腦教室" cannot pull in unrelated rooms.
    query_room = re.search(r'(?<![a-z0-9])([a-z]?\d+[a-z]?)(?=電腦教室|教室)', q)
    if query_room:
        place_room = re.search(r'([a-z]?\d+[a-z]?)電腦教室', place)
        return bool(place_room and query_room.group(1) == place_room.group(1))
    variants = place_variants(place)
    if any(v in q for v in variants if v not in {'電腦教室', '教室'}):
        return True
    core = compact(re.sub(r'^\d+樓', '', place).replace('資處科', '資處').replace('資料處理科', '資處'))
    # 只有具辨識度的場所核心才可直接命中；避免「電腦教室」把所有電腦教室一起命中
    if core and core in q and re.search(r'[a-z0-9]', core):
        return True
    if building and building in q and re.sub(r'^\d+樓', '', place) in q:
        return True
    return False


def staff_hits(q):
    data = load_json('staff_extensions.json')
    rec = data.get('分機紀錄', [])
    out = []
    cq = compact(q)
    for r in rec:
        name = compact(r.get('姓名'))
        role = compact(r.get('職稱'))
        unit = compact(r.get('單位'))
        if (name and name in cq) or (role and role in cq and len(role) >= 2) or (unit and unit in cq and len(unit) >= 2):
            out.append({'單位': r.get('單位',''), '職稱': r.get('職稱',''), '姓名': r.get('姓名',''), '分機': r.get('分機',[])})
    return out[:12]


def month_from_query(query):
    match = re.search(r'(\d{1,2}|[一二三四五六七八九十]{1,3})月', compact(query))
    if not match:
        return None
    token = match.group(1)
    if token.isdigit():
        month = int(token)
    else:
        month = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6,
                 '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12}.get(token)
    return month if month and 1 <= month <= 12 else None


def extension_results(q):
    data = load_json('staff_extensions.json')
    classes = load_json('class_extensions.json')
    out = {}
    cq = compact(q)
    class_hits = [{'班級': k, '分機': v} for k, v in classes.get('班級分機', {}).items() if compact(k) in cq]
    if class_hits:
        out['班級分機'] = class_hits
    rooms = data.get('場館分機', [])
    room_hits = [r for r in rooms if room_match(q, r)]
    if room_hits:
        out['場館分機'] = room_hits
    if not room_hits:
        sh = staff_hits(q)
        if sh:
            out['分機總表紀錄'] = sh
    if out:
        out['分機資料來源'] = {
            '文件': data.get('資料名稱', '鶯歌工商分機公告版'),
            '公告日期': data.get('資料日期', ''),
            '來源檔案': data.get('來源檔案', ''),
            '校方網站': 'https://www.ykvs.ntpc.edu.tw/'
        }
    return out


def calendar_results(q):
    d = load_json('english_center.json')
    weeks = d.get('calendar_weeks', [])
    cq = compact(q)
    dates = re.findall(r'(\d{1,2})月(\d{1,2})日', cq)
    month = month_from_query(q)
    out = []
    for w in weeks:
        ds = w.get('每日日期', [])
        if dates and not any(str(x).endswith(f'-{int(dates[0][0]):02d}-{int(dates[0][1]):02d}') for x in ds):
            continue
        if not dates and month and not any(f'-{month:02d}-' in str(x) for x in ds):
            continue
        out.append({'週別': w.get('週別'), '日期起': w.get('日期起'), '日期迄': w.get('日期迄'), '各處室行程': w.get('各處室行程', {})})
        if len(out) >= 8:
            break
    return {'查詢月份': month, '行事曆': out, '來源': d.get('calendar_source', '請查校方最新公告')}


def search_school_info(query: str):
    q = str(query or '').strip()
    cq = compact(q)
    if not q:
        return {'錯誤': '請輸入查詢內容。'}
    if any(x in cq for x in ['法規','規定','條文','原文','正式文件']):
        for fn, meta in REGULATIONS.items():
            if any(compact(k) in cq for k in meta['keywords']):
                p = REG / fn
                text = p.read_text(encoding='utf-8') if p.exists() else ''
                return {'查詢': q, '法規結果': [{'文件': meta['title'], '原文摘錄': text[:5000], '來源': 'https://www.ykvs.ntpc.edu.tw/'}]}
    # Exact name queries (including a bare name) should reliably select staff data.
    staff_data = load_json('staff_extensions.json')
    name_hits = [r for r in staff_data.get('分機紀錄', [])
                 if compact(r.get('姓名')) and compact(r.get('姓名')) in cq]
    if name_hits:
        return {'查詢': q, '分機總表紀錄': [
            {'單位': r.get('單位', ''), '職稱': r.get('職稱', ''),
             '姓名': r.get('姓名', ''), '分機': r.get('分機', [])}
            for r in name_hits[:12]
        ], '分機資料來源': {
            '文件': staff_data.get('資料名稱', '鶯歌工商分機公告版'),
            '公告日期': staff_data.get('資料日期', ''),
            '校方網站': 'https://www.ykvs.ntpc.edu.tw/'
        }}
    if any(x in cq for x in ['行事曆','行事历','行程']) or re.search(r'\d{1,2}月\d{1,2}日', cq) or month_from_query(q):
        return {'查詢': q, **calendar_results(q)}
    ext = extension_results(q)
    if ext:
        return {'查詢': q, **ext}
    return {'查詢': q, '結果': '在目前校方資料中找不到明確紀錄。', '官方首頁': 'https://www.ykvs.ntpc.edu.tw/'}


TOOL = {
    'name': 'search_school_info',
    'description': '查詢鶯歌工商校務公開資料，包含人員、職稱、分機、班級、教室、場館、行事曆與明確指定的規定/法規。查不到就回傳沒有明確紀錄，不自行猜測。',
    'inputSchema': {
        'type': 'object',
        'properties': {'query': {'type': 'string', 'description': '使用者的自然語言校務問題'}},
        'required': ['query']
    }
}


def send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            method = msg.get('method')
            mid = msg.get('id')
            params = msg.get('params') or {}
            if method == 'initialize':
                if mid is not None:
                    send({'jsonrpc':'2.0','id':mid,'result':{
                        'protocolVersion': params.get('protocolVersion','2025-06-18'),
                        'capabilities': {'tools': {}},
                        'serverInfo': {'name':'ykvs_school','version':'1.0.0'}
                    }})
            elif method == 'notifications/initialized':
                continue
            elif method == 'tools/list':
                if mid is not None:
                    send({'jsonrpc':'2.0','id':mid,'result':{'tools':[TOOL]}})
            elif method == 'tools/call':
                name = params.get('name')
                args = params.get('arguments') or {}
                if name != 'search_school_info':
                    raise ValueError(f'未知工具：{name}')
                result = search_school_info(args.get('query',''))
                payload = json.dumps(result, ensure_ascii=False)
                if mid is not None:
                    send({'jsonrpc':'2.0','id':mid,'result':{'content':[{'type':'text','text':payload}], 'isError':False}})
            elif mid is not None:
                send({'jsonrpc':'2.0','id':mid,'error':{'code':-32601,'message':f'未知方法：{method}'}})
        except Exception as e:
            if msg.get('id') is not None:
                send({'jsonrpc':'2.0','id':msg.get('id'),'error':{'code':-32000,'message':str(e)}})

if __name__ == '__main__':
    main()
