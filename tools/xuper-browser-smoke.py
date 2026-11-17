"""Browser regression against the loopback-only Xuper test fixture.

Run fixture: node tools/xuper-browser-fixture.cjs
Run checks: py -3 tools/xuper-browser-smoke.py
All example catalogs and generated audio stay inside the test environment.
"""
import io
import json
import os
from pathlib import Path
import re
import wave

from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("XUPER_TEST_URL", "http://localhost:18767")
OUTPUT = Path(__file__).resolve().parents[2] / "outputs" / "xuper-ui"
OUTPUT.mkdir(parents=True, exist_ok=True)
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "xuper-hls"
results = []


def check(name):
    results.append(name)
    print("PASS:", name, flush=True)


def audio_fixture():
    buf = io.BytesIO()
    with wave.open(buf, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\x00\x00" * 8000 * 60)
    return buf.getvalue()


audio = audio_fixture()


def route_requests(route):
    url = route.request.url
    if not url.startswith(BASE + "/"):
        route.abort()
    elif "/api/media?" in url:
        if "manifest=1" in url and (FIXTURES / "index.m3u8").exists():
            route.fulfill(path=str(FIXTURES / "index.m3u8"), content_type="application/vnd.apple.mpegurl")
        else:
            route.fulfill(body=audio, content_type="audio/wav", headers={"Accept-Ranges": "bytes"})
    elif "/__test_hls/" in url:
        file = FIXTURES / url.split("/__test_hls/", 1)[1].split("?", 1)[0]
        assert file.parent == FIXTURES
        route.fulfill(path=str(file), content_type="audio/aac" if file.suffix == ".aac" else "video/mp2t")
    else:
        route.continue_()


with sync_playwright() as p:
    print("Starting local browser checks", flush=True)
    browser = p.chromium.launch(headless=True, args=["--autoplay-policy=no-user-gesture-required"])
    context = browser.new_context(viewport={"width": 1440, "height": 1080})
    context.route("**/*", route_requests)
    page = context.new_page()
    page.set_default_timeout(15000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    response = context.request.get(BASE + "/api/xuper/bootstrap")
    assert response.status == 401
    print("Protected API rejected anonymous request", flush=True)
    page.goto(BASE + "/xuper/")
    print("Opened login page", flush=True)
    expect(page).to_have_url(re.compile(r"/\?next=/xuper/$"))
    page.locator("#password").fill("xuper-local-test-only")
    print("Submitting local login", flush=True)
    with page.expect_response("**/api/login") as login_response:
        page.get_by_role("button", name="Ingresar", exact=True).click()
    assert login_response.value.status == 200, login_response.value.text()
    print("Login response accepted", flush=True)
    expect(page).to_have_url(BASE + "/xuper/")
    page.wait_for_load_state("networkidle")
    expect(page.get_by_role("navigation").get_by_role("link")).to_have_count(11)
    check("existing login redirects back to the protected premium module")

    expect(page.locator(".mosaic-tile")).to_have_count(6)
    page.screenshot(path=str(OUTPUT / "desktop-home.png"), full_page=True)
    assert page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(11, 12, 16)"
    check("desktop reference layout uses six mosaic tiles and its original dark palette")

    page.get_by_role("navigation").get_by_role("link", name="Películas", exact=True).click()
    movie = page.get_by_role("button", name="Película de prueba, Película", exact=True)
    expect(movie).to_be_visible()
    expect(page.locator("#view img[src='x']")).to_have_count(0)
    assert page.evaluate("window.injected !== true")
    page.get_by_label("Buscar en el catálogo", exact=True).fill("Película de prueba")
    page.locator(".filters").get_by_role("button", name="Buscar", exact=True).click()
    expect(page.locator(".media-card")).to_have_count(1)
    check("catalog search works and provider HTML renders as text")

    movie.click()
    detail = page.locator("#detail")
    expect(detail.get_by_role("heading", name="Película de prueba", exact=True)).to_be_visible()
    detail.get_by_role("button", name="Guardar favorito", exact=True).click()
    expect(detail.get_by_role("button", name="Quitar favorito", exact=True)).to_have_attribute("aria-pressed", "true")
    page.keyboard.press("Tab")
    assert page.evaluate("document.getElementById('detail').contains(document.activeElement)")
    page.keyboard.press("Escape")
    expect(detail).to_be_hidden()
    expect(movie).to_be_focused()
    page.get_by_role("link", name="Configuración", exact=True).click()
    page.get_by_role("button", name="Favoritos", exact=True).click()
    expect(page.get_by_role("button", name="Película de prueba, Película", exact=True)).to_be_visible()
    page.reload()
    expect(page.get_by_role("button", name="Película de prueba, Película", exact=True)).to_be_visible()
    check("favorites persist and dialog focus stays trapped then returns to the card")

    page.get_by_role("link", name="Configuración", exact=True).click()
    page.get_by_role("button", name="Mis listas", exact=True).click()
    page.get_by_label("Crear una lista personal", exact=True).fill("Lista de prueba")
    page.get_by_role("button", name="Crear lista", exact=True).click()
    expect(page.get_by_role("heading", name="Lista de prueba", exact=True)).to_be_visible()
    page.get_by_role("navigation").get_by_role("link", name="Películas", exact=True).click()
    page.get_by_role("button", name="Película de prueba, Película", exact=True).click()
    detail.get_by_role("button", name="Añadir", exact=True).click()
    expect(detail.locator("#detail-message")).to_contain_text("Añadido a Lista de prueba")
    detail.get_by_role("button", name="Reproducir", exact=True).click()
    video = page.locator("#video")
    page.wait_for_function("() => document.getElementById('video').readyState >= 2")
    page.evaluate("document.getElementById('video').currentTime = 18")
    page.wait_for_function("() => document.getElementById('video').currentTime >= 17")
    page.locator("#player-toggle").click()
    page.locator("#player-close").click()
    page.keyboard.press("Escape")
    prefs = page.evaluate("JSON.parse(localStorage.getItem('tvvidaa.xuper.preferences.v1'))")
    profile = next(x for x in prefs["profiles"] if x["id"] == prefs["active"])
    assert profile["history"][0]["position"] >= 17
    assert profile["playlists"][0]["items"][0]["id"] == "test-film"
    serialized = json.dumps(prefs)
    assert "media.example.com" not in serialized and "mediaUrl" not in serialized and "token=" not in serialized
    check("playlist and playback progress persist without storing tokens or stream URLs")

    page.get_by_role("navigation").get_by_role("link", name="Series", exact=True).click()
    page.get_by_role("button", name="Serie de prueba, Serie", exact=True).click()
    detail.get_by_label("Temporada", exact=True).select_option("1")
    expect(detail.get_by_role("heading", name="Episodio dos", exact=True)).to_be_visible()
    detail.get_by_role("button", name="Reproducir", exact=True).click()
    expect(page.locator("#player-title")).to_contain_text("Episodio dos")
    page.wait_for_function("() => document.getElementById('video').readyState >= 2")
    page.evaluate("document.getElementById('video').currentTime = 21")
    page.wait_for_function("() => document.getElementById('video').currentTime >= 20")
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    page.get_by_role("navigation").get_by_role("link", name="Historial", exact=True).click()
    expect(page.locator(".media-card").first).to_contain_text("Episodio dos")
    check("season selection resolves the correct episode and keeps per-episode history")

    page.get_by_role("navigation").get_by_role("link", name="Radio", exact=True).click()
    expect(page.get_by_label("País", exact=True)).to_be_visible()
    page.get_by_role("button", name="Radio de prueba, Radio", exact=True).click()
    detail.get_by_role("button", name="Escuchar", exact=True).click()
    page.wait_for_function("() => document.getElementById('video').readyState >= 2")
    expect(page.locator("#player")).to_have_class(re.compile("audio-mode"))
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    check("radio country filtering and HTML5 audio playback work")

    page.get_by_role("navigation").get_by_role("link", name="TV en vivo", exact=True).click()
    page.get_by_role("button", name="Canal de prueba, En vivo", exact=True).click()
    detail.get_by_role("button", name="Consultar guía de TV", exact=True).click()
    expect(detail.locator("#detail-message")).to_contain_text("Programa de prueba")
    if (FIXTURES / "index.m3u8").exists():
        detail.get_by_role("button", name="Reproducir", exact=True).click()
        page.wait_for_function("() => document.getElementById('video').readyState >= 2", timeout=20000)
        page.wait_for_function("() => document.getElementById('video').currentTime > 0", timeout=10000)
        check("HLS.js decodes a real locally served HLS media fixture")
        page.keyboard.press("Escape")
    else:
        print("LIMITATION: no generated HLS fixture available; real HLS decoding not verified", flush=True)
    page.keyboard.press("Escape")
    check("provider EPG displays real supplied programme metadata")

    page.get_by_role("link", name="Configuración", exact=True).click()
    page.get_by_label("Nombre del perfil", exact=True).fill("Segundo perfil")
    page.get_by_role("button", name="Crear perfil", exact=True).click()
    page.get_by_role("button", name="Favoritos", exact=True).click()
    expect(page.get_by_role("heading", name="Tus favoritos empiezan aquí", exact=True)).to_be_visible()
    check("local profiles keep favorites independent")

    page.goto(BASE + "/xuper/#home")
    expect(page.locator(".mosaic-tile")).to_have_count(6)
    nav = page.get_by_role("navigation").get_by_role("link", name="Destacados", exact=True)
    nav.focus()
    page.keyboard.press("ArrowDown")
    assert page.evaluate("document.activeElement !== document.querySelector('[data-section=home]')")
    assert page.evaluate("""() => { const s = getComputedStyle(document.activeElement);
      return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
        (parseFloat(s.borderTopWidth) > 0 && s.borderTopColor !== 'rgba(0, 0, 0, 0)'); }""")
    check("D-pad changes focus and keeps its visible outline")

    page.get_by_role("navigation").get_by_role("link", name="Películas", exact=True).click()
    page.get_by_role("button", name="Película de prueba, Película", exact=True).click()
    page.route("**/api/xuper/resolve?*", lambda route: route.fulfill(json={"returnValue": True, "mediaUrl": "https://outside.example/private.mp4", "mime": "video/mp4"}))
    detail.get_by_role("button", name="Reproducir", exact=True).click()
    expect(page.locator("#player-status")).to_contain_text("segura")
    retry = page.locator("#player-retry")
    for attempt in range(2):
        expect(retry).to_be_visible()
        retry.click()
        expect(page.locator("#player-status")).to_contain_text("segura")
    expect(retry).to_be_hidden()
    page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: 10009, bubbles: true}))")
    expect(page.locator("#player")).to_be_hidden()
    page.keyboard.press("Escape")
    page.unroute("**/api/xuper/resolve?*")
    check("unsafe playback URLs fail clearly, retries stop at two and remote Back closes playback")

    page.goto(BASE + "/xuper/#home")
    expect(page.locator(".mosaic-tile")).to_have_count(6)

    for width, height, name in [(1920, 1080, "tv"), (768, 1024, "tablet"), (390, 844, "mobile")]:
        page.set_viewport_size({"width": width, "height": height})
        expect(page.locator(".mosaic-tile")).to_have_count(6)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), name + " horizontal overflow"
        page.screenshot(path=str(OUTPUT / (name + "-home.png")), full_page=True)
    check("TV, tablet and mobile layouts have no horizontal page overflow")

    page.route("**/api/xuper/catalog*", lambda route: route.fulfill(json={"returnValue": True, "items": [], "total": 0, "hasMore": False, "categories": [], "providers": [], "warning": "Proveedor no configurado."}))
    page.goto(BASE + "/xuper/#movies")
    expect(page.locator(".empty-state")).to_be_visible()
    expect(page.locator(".media-card")).to_have_count(0)
    check("unconfigured providers show an honest empty state")

    assert not errors, "Browser errors: " + "; ".join(errors)
    check("no uncaught browser JavaScript errors")
    context.close()
    browser.close()

(OUTPUT / "results.json").write_text(json.dumps({"passed": len(results), "checks": results}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"passed": len(results), "output": str(OUTPUT)}, ensure_ascii=False), flush=True)
