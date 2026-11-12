'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../web/js/app.js'), 'utf8');

function helper(name) {
  const match = new RegExp('  function ' + name + '\\([^]*?\\n  \\}').exec(source);
  assert.ok(match, 'real app helper: ' + name);
  return match[0];
}

function focusFixture(screen) {
  const document = {
    activeElement: null,
    querySelectorAll() { assert.fail('navigation must stay within the active screen'); }
  };
  const roots = {};
  const context = {
    document, state: { screen, diagnosticSeq: 0 }, previousScreen: 'catalog',
    $: id => roots[id],
    window: { history: { length: 1 }, close() { assert.fail('Back from an input must not exit'); } },
    closePlayer() {}, closeDetail() {}, closeDiagnostics() {},
    show() {}
  };
  function control(root, id, left, top, options = {}) {
    const rect = { left, top, width: options.width || 100, height: 50 };
    const node = {
      id, tagName: options.tag || 'BUTTON', disabled: !!options.disabled,
      offsetWidth: options.hidden ? 0 : rect.width,
      offsetHeight: options.hidden ? 0 : rect.height,
      value: options.value || '', selectionStart: 0, selectionEnd: 0, clicks: 0,
      getBoundingClientRect() { return rect; },
      focus() { document.activeElement = node; },
      blur() { if (document.activeElement === node) document.activeElement = null; },
      click() { node.clicks++; },
      scrollIntoView() {}
    };
    if (!roots[root]) {
      const children = [];
      roots[root] = { children, querySelectorAll() { return children.filter(child => !child.disabled); } };
    }
    roots[root].children.push(node);
    roots[id] = node;
    return node;
  }
  vm.runInNewContext(['focusScopeControls', 'navigate', 'handleRemote'].map(helper).join('\n'), context);
  function key(keyCode, options = {}) {
    const event = { keyCode, ...options, prevented: false, preventDefault() { this.prevented = true; } };
    context.handleRemote(event);
    return event;
  }
  return { context, roots, control, key, document };
}

for (const screen of ['detail', 'player', 'diagnostics']) {
  test(screen + ' overlay arrows and Tab cannot focus the catalog behind it', () => {
    const f = focusFixture(screen);
    const first = f.control(screen, 'first', 100, 100);
    const last = f.control(screen, 'last', 400, 100);
    const background = f.control('shell', 'background', 240, 100);
    f.control(screen, 'disabled', 200, 100, { disabled: true });
    f.control(screen, 'hidden', 300, 100, { hidden: true });
    first.focus();
    f.key(39);
    assert.equal(f.document.activeElement, last);
    f.key(9);
    assert.equal(f.document.activeElement, first);
    f.key(9, { shiftKey: true });
    assert.equal(f.document.activeElement, last);
    background.focus();
    f.key(40);
    assert.equal(f.document.activeElement, first);
  });
}

test('password D-pad reaches eye and submit while text caret keys keep native behavior', () => {
  const f = focusFixture('login');
  const password = f.control('auth', 'password', 0, 0, { tag: 'INPUT', width: 300, value: 'sample' });
  const eye = f.control('auth', 'eye', 250, 0, { width: 50 });
  const submit = f.control('auth', 'submit', 0, 90, { width: 300 });
  password.focus();
  password.selectionStart = password.selectionEnd = 2;
  assert.equal(f.key(39).prevented, false);
  assert.equal(f.document.activeElement, password);
  assert.equal(f.key(8).prevented, false);
  password.selectionStart = password.selectionEnd = password.value.length;
  assert.equal(f.key(39).prevented, true);
  assert.equal(f.document.activeElement, eye);
  f.key(13);
  assert.equal(eye.clicks, 1);
  password.focus();
  f.key(40);
  assert.equal(f.document.activeElement, submit);
  f.key(13);
  assert.equal(submit.clicks, 1);
  password.focus();
  f.key(461);
  assert.equal(f.document.activeElement, submit);
  f.key(38);
  assert.equal(f.document.activeElement, password);
  f.key(9, { shiftKey: true });
  assert.equal(f.document.activeElement, submit);
});

test('profile keeps native option arrows and search can return to catalog controls', () => {
  const f = focusFixture('catalog');
  const profile = f.control('shell', 'profile', 0, 0, { tag: 'SELECT' });
  const shortcut = f.control('shell', 'searchShortcut', 150, 0);
  const search = f.control('shell', 'search', 0, 110, { tag: 'INPUT', width: 250, value: 'news' });
  const clear = f.control('shell', 'clear', 300, 110);
  const result = f.control('shell', 'result', 0, 250);
  profile.focus();
  assert.equal(f.key(40).prevented, false);
  assert.equal(f.document.activeElement, profile);
  f.key(39);
  assert.equal(f.document.activeElement, shortcut);
  profile.focus();
  f.key(27);
  assert.equal(f.document.activeElement, shortcut);
  search.focus();
  f.key(40);
  assert.equal(f.document.activeElement, result);
  search.focus();
  search.selectionStart = search.selectionEnd = search.value.length;
  f.key(39);
  assert.equal(f.document.activeElement, clear);
  search.focus();
  f.key(461);
  assert.equal(f.document.activeElement, result);
});

test('closing diagnostics opened from detail restores focus inside the detail overlay', () => {
  const f = focusFixture('diagnostics');
  const detailBack = f.control('detail', 'detailBack', 0, 0);
  f.control('shell', 'diagnosticsButton', 0, 0);
  f.context.previousScreen = 'detail';
  vm.runInNewContext(helper('closeDiagnostics'), f.context);
  f.context.closeDiagnostics();
  assert.equal(f.context.state.screen, 'detail');
  assert.equal(f.document.activeElement, detailBack);
});

test('login disables the submit button, keeps the eye available and prevents duplicate requests', () => {
  const submit = { disabled: false }, eye = { disabled: false };
  const password = { value: 'fixture-value' };
  const requests = [], messages = [];
  let entered = 0;
  const context = {
    $: id => id === 'password' ? password : {
      querySelector(selector) { assert.equal(selector, 'button[type="submit"]'); return submit; }
    },
    text(_id, value) { messages.push(value); },
    api(method, body, callback) { requests.push({ method, body, callback }); },
    enter() { entered++; }, setPasswordVisible() {}
  };
  vm.runInNewContext(helper('login'), context);
  context.login({ preventDefault() {} });
  assert.equal(submit.disabled, true);
  assert.equal(eye.disabled, false);
  context.login({ preventDefault() {} });
  assert.equal(requests.length, 1);
  requests[0].callback('Error de prueba');
  assert.equal(submit.disabled, false);
  context.login({ preventDefault() {} });
  assert.equal(requests.length, 2);
  requests[1].callback(null, { authenticated: true });
  assert.equal(submit.disabled, false);
  assert.equal(password.value, '');
  assert.equal(entered, 1);
  assert.equal(messages.includes('Error de prueba'), true);
});
