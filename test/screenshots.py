"""README에 넣는 화면 캡처를 다시 만든다.

    node build.mjs && python3 test/screenshots.py

설치된 Chrome을 쓰려면 CHROME_PATH 환경 변수에 실행 파일 경로를 넣는다.
결과는 screenshots/ 에 덮어쓴다.
"""
import os
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "docs" / "index.html").as_uri()
OUT = ROOT / "screenshots"
OUT.mkdir(exist_ok=True)
CHROME = os.environ.get("CHROME_PATH")


def open_page(browser, *, width, height, scale, scheme, touch=False):
    context = browser.new_context(
        viewport={"width": width, "height": height},
        device_scale_factor=scale,
        color_scheme=scheme,
        has_touch=touch,
        is_mobile=touch,
        locale="ko-KR",
    )
    page = context.new_page()
    page.goto(URL, wait_until="load")
    page.wait_for_selector("#wafers .wf >> nth=24")
    page.wait_for_timeout(600)  # 웹폰트와 첫 그리기를 기다린다
    return context, page


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, args=["--no-sandbox"]) if CHROME else pw.chromium.launch()

    # 1. 데스크톱, 밝은 테마: 가장자리 링 웨이퍼에서 불량 다이 하나를 고정한 상태
    ctx, page = open_page(browser, width=1440, height=900, scale=1.25, scheme="light")
    box = page.locator("#stage").bounding_box()
    page.mouse.click(box["x"] + box["width"] * 0.085, box["y"] + box["height"] * 0.5)
    page.mouse.move(8, 400)
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUT / "desktop-light.png"))
    ctx.close()

    # 2. 데스크톱, 어두운 테마: 25매를 겹친 합성 맵
    ctx, page = open_page(browser, width=1440, height=900, scale=1.25, scheme="dark")
    page.locator("#mode-lot").check()
    page.mouse.move(8, 400)
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / "desktop-dark-lot.png"))
    ctx.close()

    # 3. 모바일, 밝은 테마: 첫 화면
    ctx, page = open_page(browser, width=390, height=844, scale=2, scheme="light", touch=True)
    page.screenshot(path=str(OUT / "mobile-light.png"))
    ctx.close()

    # 4. 모바일, 어두운 테마: 패턴 이름으로 찾기
    ctx, page = open_page(browser, width=390, height=844, scale=2, scheme="dark", touch=True)
    page.click("#open-palette")
    page.fill("#palette-input", "edge")
    page.wait_for_timeout(350)
    page.screenshot(path=str(OUT / "mobile-dark-find.png"))
    ctx.close()

    browser.close()

for path in sorted(OUT.glob("*.png")):
    print(f"{path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")
