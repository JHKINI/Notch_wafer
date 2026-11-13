"""브라우저에서 실제로 돌려 보는 점검. 화면 캡처와 조작 시나리오를 한 번에 돈다.

    pip install playwright && playwright install chromium   # 처음 한 번
    node build.mjs && python3 test/e2e.py

설치된 Chrome을 쓰려면 CHROME_PATH 환경 변수에 실행 파일 경로를 넣는다.
캡처는 test/shots/ 에 남는다(커밋하지 않는다).
"""
import json
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "docs" / "index.html").as_uri()
SHOTS = ROOT / "test" / "shots"
CHROME = os.environ.get("CHROME_PATH")
SHOTS.mkdir(parents=True, exist_ok=True)

failures = []
problems = []


def check(name, cond, detail=""):
    mark = "ok  " if cond else "FAIL"
    print(f"  {mark} {name}{'  ' + str(detail) if detail and not cond else ''}")
    if not cond:
        failures.append(name)


def open_page(browser, *, width, height, scale, scheme, touch=False, hash_=""):
    context = browser.new_context(
        viewport={"width": width, "height": height},
        device_scale_factor=scale,
        color_scheme=scheme,
        has_touch=touch,
        is_mobile=touch,
        locale="ko-KR",
    )
    # 웹폰트는 받지 않는다. 네트워크 상태와 무관하게 같은 결과가 나오도록 대체 글꼴로 점검한다.
    context.route("**/fonts.googleapis.com/**", lambda route: route.abort())
    context.route("**/fonts.gstatic.com/**", lambda route: route.abort())
    page = context.new_page()
    page.on("console", lambda m: problems.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") and "fonts.g" not in m.text and "ERR_FAILED" not in m.text else None)
    page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
    page.goto(URL + hash_, wait_until="load")
    page.wait_for_selector("#wafers .wf >> nth=24")
    page.wait_for_timeout(350)
    return context, page


def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")


def text(page, sel):
    return page.inner_text(sel).strip()


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, args=["--no-sandbox"]) if CHROME else pw.chromium.launch()

    # ---------------------------------------------------------------- 모바일, 밝은 테마
    print("mobile / light")
    ctx, page = open_page(browser, width=390, height=844, scale=3, scheme="light", touch=True)
    check("가로 넘침 없음", overflow(page) <= 0, overflow(page))
    check("오류 배너 없음", page.is_hidden("#fatal"))
    check("웨이퍼 25매", page.locator("#wafers .wf").count() == 25)
    check("첫 화면: 가장 나쁜 이탈 웨이퍼", text(page, "#detail-title") == "슬롯 08", text(page, "#detail-title"))
    check("주소에 경로 반영", page.evaluate("location.hash") == "#k7a2417-08", page.evaluate("location.hash"))
    check("패턴 판정 표시", "Edge-Ring" in text(page, "#pattern-name"), text(page, "#pattern-name"))
    painted = page.evaluate(
        """() => { const c = document.getElementById('map'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++; return n; }"""
    )
    check("맵 캔버스가 그려짐", painted > 500, painted)
    thumb = page.evaluate(
        """() => { const c = document.querySelector('#wafers canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return [c.width, n]; }"""
    )
    check("썸네일이 기기 해상도로 그려짐", thumb[0] == 132 and thumb[1] > 5000, thumb)
    page.screenshot(path=str(SHOTS / "mobile-light-top.png"))
    page.screenshot(path=str(SHOTS / "mobile-light-full.png"), full_page=True)

    # 터치: 다이 누르기 → 판독값
    box = page.locator("#stage").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.touchscreen.tap(cx + 20, cy + 30)
    page.wait_for_timeout(120)
    check("터치로 다이 선택", text(page, "#ro-v1").startswith("X "), text(page, "#ro-v1"))
    check("판정 표시", text(page, "#ro-v2").startswith("BIN "), text(page, "#ro-v2"))

    # 터치: 좌우로 밀어 다음 웨이퍼 (CDP로 실제 터치 이벤트를 보낸다)
    cdp = ctx.new_cdp_session(page)

    def touch(kind, points):
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)]})

    page.wait_for_timeout(400)
    touch("touchStart", [(cx + 90, cy)])
    for step in range(1, 9):
        touch("touchMove", [(cx + 90 - step * 22, cy + 1)])
    touch("touchEnd", [])
    page.wait_for_timeout(450)
    check("왼쪽으로 밀면 다음 웨이퍼", text(page, "#detail-title") == "슬롯 09", text(page, "#detail-title"))

    # 터치: 두 손가락 벌려 확대 → 한 손가락으로 끌기
    touch("touchStart", [(cx - 30, cy), (cx + 30, cy)])
    for step in range(1, 9):
        touch("touchMove", [(cx - 30 - step * 12, cy), (cx + 30 + step * 12, cy)])
    touch("touchEnd", [])
    page.wait_for_timeout(200)
    zoom_text = text(page, "#zoom-level")
    check("두 손가락으로 확대", zoom_text not in ("1×",) and float(zoom_text[:-1]) > 2, zoom_text)
    check("확대하면 제스처를 모두 받음", page.get_attribute("#stage", "data-zoomed") is not None)
    check("눈금자 갱신", text(page, "#scalebar-label") != "50 mm", text(page, "#scalebar-label"))
    page.screenshot(path=str(SHOTS / "mobile-light-zoom.png"))
    page.click("#zoom-reset")
    page.wait_for_timeout(350)
    check("전체 보기로 복귀", text(page, "#zoom-level") == "1×", text(page, "#zoom-level"))

    # 찾기: 모바일에서도 버튼으로 열림
    page.click("#open-palette")
    page.wait_for_timeout(250)
    check("찾기 대화상자 열림", page.evaluate("document.getElementById('palette').open"))
    page.fill("#palette-input", "scratch")
    page.wait_for_timeout(80)
    check("패턴 이름으로 검색", "슬롯 17" in text(page, "#palette-list .palette-item >> nth=0"), text(page, "#palette-list"))
    page.screenshot(path=str(SHOTS / "mobile-light-palette.png"))
    page.keyboard.press("Enter")
    page.wait_for_timeout(450)
    check("검색 결과 실행", text(page, "#detail-title") == "슬롯 17" and not page.evaluate("document.getElementById('palette').open"), text(page, "#detail-title"))
    check("Scratch 판정 근거", "선" in text(page, "#pattern-why"), text(page, "#pattern-why"))
    check("가로 넘침 없음(조작 후)", overflow(page) <= 0, overflow(page))
    ctx.close()

    # ---------------------------------------------------------------- 모바일, 어두운 테마
    print("mobile / dark")
    ctx, page = open_page(browser, width=390, height=844, scale=3, scheme="dark", touch=True)
    check("어두운 테마 토큰 적용", page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(14, 15, 21)", page.evaluate("getComputedStyle(document.body).backgroundColor"))
    page.locator("#mode-lot").check()
    page.wait_for_timeout(200)
    check("합성 맵: 범위가 로트로 바뀜", text(page, "#detail-title") == "로트 전체", text(page, "#detail-title"))
    check("합성 맵: 범례 6단계", page.locator("#legend .swatch").count() == 6, page.locator("#legend .swatch").count())
    page.screenshot(path=str(SHOTS / "mobile-dark-lot-full.png"), full_page=True)
    ctx.close()

    # ---------------------------------------------------------------- 데스크톱, 어두운 테마
    print("desktop / dark")
    ctx, page = open_page(browser, width=1440, height=900, scale=2, scheme="dark")
    check("가로 넘침 없음", overflow(page) <= 0, overflow(page))
    page.screenshot(path=str(SHOTS / "desktop-dark.png"), full_page=True)

    # 키보드
    page.keyboard.press("j")
    page.wait_for_timeout(350)
    check("J: 다음 웨이퍼", text(page, "#detail-title") == "슬롯 09", text(page, "#detail-title"))
    page.keyboard.press("n")
    page.wait_for_timeout(350)
    check("N: 다음 이탈 웨이퍼(순환)", text(page, "#detail-title") == "슬롯 06", text(page, "#detail-title"))
    page.keyboard.press("m")
    page.wait_for_timeout(150)
    check("M: 합성 맵", text(page, "#detail-title") == "로트 전체")
    page.keyboard.press("m")
    page.wait_for_timeout(350)

    # 목록: 방향키로 이동, 격자에서는 위아래가 한 줄(5칸)
    page.focus("#wafers .wf[aria-selected='true']")
    page.keyboard.press("ArrowDown")
    page.wait_for_timeout(350)
    check("목록 ↓: 한 줄 아래", text(page, "#detail-title") == "슬롯 11", text(page, "#detail-title"))
    check("선택이 초점을 따라감", page.evaluate("document.activeElement.dataset.slot") == "11", page.evaluate("document.activeElement.dataset.slot"))

    # 불량 유형 강조
    page.click("#wafers .wf[data-slot='8']")
    page.wait_for_timeout(350)
    first_bin = page.locator("#bins .bin").first
    check("가장 많은 유형이 맨 위", "누설 전류" in first_bin.inner_text(), first_bin.inner_text())
    first_bin.click()
    page.wait_for_timeout(120)
    check("강조 켜짐", first_bin.get_attribute("aria-pressed") == "true")
    check("누른 버튼의 초점 유지", page.evaluate("document.activeElement.classList.contains('bin')"))
    check("범례에 그 외 불량 추가", page.locator("#legend .swatch").count() == 3)
    check("강조 해제 버튼 보임", page.is_visible("#clear-bin"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(120)
    check("Esc로 강조 해제", first_bin.get_attribute("aria-pressed") == "false")

    # 보류 지정과 실행 취소
    page.click("#toggle-hold")
    page.wait_for_timeout(150)
    check("보류 지정 → 알림", "보류로 지정했습니다" in text(page, "#toasts"), text(page, "#toasts"))
    check("보류 수 반영", text(page, "#lot-hold") == "1")
    check("버튼 문구가 다음 동작으로 바뀜", text(page, "#hold-label") == "보류 해제")
    check("썸네일에 보류 표시", page.is_visible("#wafers .wf[data-slot='8'] .wf-hold"))
    check("브라우저에 저장", "8" in (page.evaluate("localStorage.getItem('notch.review.v1')") or ""))
    page.click("#toasts .toast-action")
    page.wait_for_timeout(150)
    check("실행 취소", text(page, "#lot-hold") == "0" and text(page, "#hold-label") == "보류 지정")

    # 맵: 마우스, 키보드, Ctrl+휠
    box = page.locator("#stage").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(cx + 40, cy + 40)
    page.wait_for_timeout(80)
    check("마우스를 올리면 판독값", text(page, "#ro-v1").startswith("X "), text(page, "#ro-v1"))
    page.mouse.click(cx, cy)
    page.wait_for_timeout(80)
    before = text(page, "#ro-v1")
    page.mouse.move(box["x"] + 5, box["y"] + 5)
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowUp")
    page.wait_for_timeout(250)
    after = text(page, "#ro-v1")
    check("방향키로 다이 이동", before != after and after.startswith("X "), f"{before} -> {after}")
    check("낭독 영역 갱신", after.split(",")[0] in text(page, "#announce"), text(page, "#announce"))
    page.mouse.move(cx + 100, cy - 60)
    page.keyboard.down("Control")
    page.mouse.wheel(0, -300)
    page.keyboard.up("Control")
    page.wait_for_timeout(200)
    check("Ctrl+휠 확대", float(text(page, "#zoom-level")[:-1]) > 1.5, text(page, "#zoom-level"))
    page.mouse.wheel(0, 200)
    page.wait_for_timeout(200)
    check("그냥 휠은 페이지 스크롤", page.evaluate("scrollY") > 0, page.evaluate("scrollY"))
    page.evaluate("scrollTo(0, 0)")
    page.keyboard.press("Escape")  # 다이 고정 해제
    page.keyboard.press("Escape")  # 확대 해제
    page.wait_for_timeout(350)
    check("Esc 단계별 해제", text(page, "#zoom-level") == "1×", text(page, "#zoom-level"))
    page.mouse.dblclick(cx - 80, cy - 40)
    page.wait_for_timeout(400)
    check("두 번 눌러 확대", text(page, "#zoom-level") == "3×", text(page, "#zoom-level"))
    page.screenshot(path=str(SHOTS / "desktop-dark-zoom.png"))
    page.click("#zoom-reset")
    page.wait_for_timeout(350)

    # 관리도: 툴팁, 클릭, 키보드, 표
    page.locator("#spc-title").scroll_into_view_if_needed()
    page.wait_for_timeout(250)  # 스크롤 이벤트가 지나간 뒤에 올려야 한다(스크롤하면 툴팁을 숨기므로)
    pt = page.locator("#chart .c-pt[data-slot='17']").bounding_box()
    page.mouse.move(pt["x"] + pt["width"] / 2, pt["y"] + 40)
    page.wait_for_timeout(120)
    check("관리도 툴팁", page.is_visible("#tip") and "슬롯 17" in text(page, "#tip"), text(page, "#tip") if page.is_visible("#tip") else "hidden")
    page.screenshot(path=str(SHOTS / "desktop-dark-chart.png"))
    page.mouse.click(pt["x"] + pt["width"] / 2, pt["y"] + 40)
    page.wait_for_timeout(350)
    check("관리도에서 웨이퍼 선택", text(page, "#detail-title") == "슬롯 17", text(page, "#detail-title"))
    page.focus("#chart .c-pt[aria-selected='true']")
    page.keyboard.press("ArrowRight")
    page.keyboard.press("Enter")
    page.wait_for_timeout(350)
    check("관리도 키보드 조작", text(page, "#detail-title") == "슬롯 18", text(page, "#detail-title"))
    page.click("#toggle-table")
    page.wait_for_timeout(120)
    check("표로 보기", page.is_visible("#tablewrap") and page.is_hidden("#chart") and page.locator("#spc-rows tr").count() == 25)
    check("표의 현재 행", page.get_attribute("#spc-rows tr[data-slot='18']", "aria-current") == "true")
    page.click("#spc-rows button[data-slot='22']")
    page.wait_for_timeout(350)
    check("표에서 웨이퍼 선택", text(page, "#detail-title") == "슬롯 22" and "Center" in text(page, "#pattern-name"), text(page, "#pattern-name"))
    page.click("#toggle-table")
    page.wait_for_timeout(200)
    check("차트로 복귀", page.locator("#chart svg").count() == 1 and page.is_visible("#chart"))

    # 정보 팝오버
    page.click("#spc-info-btn")
    page.wait_for_timeout(250)
    check("팝오버 열림", page.evaluate("document.getElementById('spc-info').matches(':popover-open')"))
    pop = page.locator("#spc-info").bounding_box()
    btn = page.locator("#spc-info-btn").bounding_box()
    check("팝오버가 버튼 아래에 붙음", abs(pop["y"] - (btn["y"] + btn["height"])) < 16 and abs(pop["x"] - btn["x"]) < 4, f"{pop} / {btn}")
    page.keyboard.press("Escape")

    # 찾기와 명령
    page.evaluate("scrollTo(0, 0)")
    page.keyboard.press("Control+k")
    page.wait_for_timeout(250)
    check("Ctrl+K", page.evaluate("document.getElementById('palette').open"))
    check("입력창에 초점", page.evaluate("document.activeElement.id") == "palette-input")
    page.keyboard.type("7")
    page.wait_for_timeout(80)
    check("숫자 검색: 단어 첫머리 우선", "슬롯 07" in text(page, "#palette-list .palette-item >> nth=0"), text(page, "#palette-list .palette-item >> nth=0"))
    page.fill("#palette-input", "없는검색어")
    page.wait_for_timeout(80)
    check("빈 결과 안내", page.is_visible("#palette-empty") and "없는검색어" in text(page, "#palette-empty"))
    page.fill("#palette-input", "로트 K7B")
    page.wait_for_timeout(80)
    page.screenshot(path=str(SHOTS / "desktop-dark-palette.png"))
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)
    check("명령으로 로트 전환", text(page, "#lot-id") == "K7B0102" and page.input_value("#lot-select") == "K7B0102", text(page, "#lot-id"))
    check("로트 전환 후 기본 웨이퍼", text(page, "#detail-title") == "슬롯 25" and "Near-full" in text(page, "#pattern-name"), text(page, "#detail-title"))
    check("주소 갱신", page.evaluate("location.hash") == "#k7b0102-25", page.evaluate("location.hash"))
    page.screenshot(path=str(SHOTS / "desktop-dark-lotC.png"), full_page=True)

    # 테마 전환
    page.click("#toggle-theme")
    page.wait_for_timeout(900)
    check("테마 전환", page.evaluate("document.documentElement.dataset.theme") == "light")
    check("전환 뒤 버튼 문구", page.get_attribute("#toggle-theme", "aria-label") == "어두운 테마로 바꾸기")
    check("밝은 테마 배경", page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(242, 243, 247)")

    # 리포트: 권한이 없는 환경이면 직접 복사 대화상자가 뜬다
    page.click("#copy-report")
    page.wait_for_timeout(300)
    copied = "복사했습니다" in page.inner_text("#toasts")
    fallback = page.evaluate("document.getElementById('report').open")
    check("리포트 복사 또는 대체 경로", copied or fallback)
    if fallback:
        check("리포트 내용", "K7B0102" in page.input_value("#report-text") and "관리 이탈" in page.input_value("#report-text"))
        page.click("#report-close")

    # 도움말
    page.keyboard.press("?")
    page.wait_for_timeout(250)
    check("? 로 도움말", page.evaluate("document.getElementById('help').open"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)
    check("Esc로 닫힘", not page.evaluate("document.getElementById('help').open"))
    check("오류 배너 없음", page.is_hidden("#fatal"))
    ctx.close()

    # ---------------------------------------------------------------- 데스크톱, 밝은 테마 + 주소로 바로 열기
    print("desktop / light / deep link")
    ctx, page = open_page(browser, width=1440, height=900, scale=2, scheme="light", hash_="#k7b0102-12")
    check("주소로 바로 열기", text(page, "#lot-id") == "K7B0102" and text(page, "#detail-title") == "슬롯 12", text(page, "#detail-title"))
    check("Donut 판정", "Donut" in text(page, "#pattern-name"), text(page, "#pattern-name"))
    page.evaluate("location.hash = '#k7a2431-14'")
    page.wait_for_timeout(500)
    check("주소 변경에 반응", text(page, "#lot-id") == "K7A2431" and text(page, "#detail-title") == "슬롯 14", text(page, "#detail-title"))
    check("이탈 없는 로트: 버튼 비활성", page.is_disabled("#next-flagged"))
    page.evaluate("location.hash = '#k7a2417-08'")
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / "desktop-light.png"), full_page=True)
    ctx.close()

    # ---------------------------------------------------------------- 태블릿 폭
    print("tablet / light")
    ctx, page = open_page(browser, width=820, height=1100, scale=2, scheme="light", touch=True)
    check("가로 넘침 없음", overflow(page) <= 0, overflow(page))
    page.screenshot(path=str(SHOTS / "tablet-light.png"), full_page=True)
    ctx.close()

    # ---------------------------------------------------------------- 좁은 화면, 모션 줄이기
    print("narrow / reduced motion")
    context = browser.new_context(viewport={"width": 320, "height": 640}, device_scale_factor=2, reduced_motion="reduce", has_touch=True, is_mobile=True)
    context.route("**/fonts.g*/**", lambda route: route.abort())
    page = context.new_page()
    page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
    page.goto(URL, wait_until="load")
    page.wait_for_selector("#wafers .wf >> nth=24")
    check("320px에서도 가로 넘침 없음", overflow(page) <= 0, overflow(page))
    page.click("#wafers .wf[data-slot='9']")
    page.wait_for_timeout(60)
    check("모션을 줄여도 동작", text(page, "#detail-title") == "슬롯 09")
    page.screenshot(path=str(SHOTS / "narrow-320.png"))
    context.close()

    browser.close()

print()
for p in problems:
    print("PROBLEM", p)
print(json.dumps({"failed": failures, "problems": len(problems)}, ensure_ascii=False))
sys.exit(1 if failures or problems else 0)
