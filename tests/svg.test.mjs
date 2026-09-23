import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sanitizeSVG, createSVGPreview } from '../static/js/svg.mjs';
import { createMarkdownRenderer } from '../static/js/rendering.mjs';
const document = new JSDOM('<!doctype html><body></body>').window.document;
const drawing = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 500"><title>Client &amp; hosts</title><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="900" height="500" fill="url(#g)"/><text x="20" y="50">Hello</text></svg>';

test('static SVG preserves artwork and escapes XML', () => {
  const clean = sanitizeSVG(drawing, document);
  assert.equal(clean.title, 'Client & hosts');
  assert.match(clean.text, /fill="url\(#g\)"/);
  assert.match(clean.text, /width="900"/);
  assert.equal(decodeURIComponent(clean.url.split(',')[1]), clean.text);
});
test('active SVG and external loads cannot survive preview or downloaded SVG', () => {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="attack()"><script>attack()</script><style>@import 'https://evil'</style><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">attack</div></foreignObject><image href="https://evil"/><a href="javascript:attack()"><text>bad</text></a><rect style="fill:url(https://evil)" fill="url(https://evil)" onclick="attack()"/><animate attributeName="href" values="https://evil"/><use href="#x"/></svg>`;
  const clean = sanitizeSVG(source, document);
  for (const term of ['attack', 'evil', 'script', 'style', 'foreignObject', '<image', '<a ', '<animate', '<use', 'onload', 'onclick']) assert.ok(!clean.text.includes(term), term);
  const card = createSVGPreview(document, source);
  assert.equal(card.querySelector('img').getAttribute('src'), card.querySelector('a').getAttribute('href'));
  assert.equal(card.querySelectorAll('svg,iframe,object').length, 0);
});
test('malformed, unbounded and entity-expanding documents fail closed', () => {
  for (const source of ['<svg', '<div/>', '<svg><rect/></svg>', '<svg viewBox="0 0 999999999 1"/>', '<!DOCTYPE svg [<!ENTITY x "x">]><svg/>', 'x'.repeat(300001), '<svg viewBox="0 0 10 10">'+'<g>'.repeat(45)+'</g>'.repeat(45)+'</svg>']) assert.throws(() => sanitizeSVG(source, document));
});
test('streaming hides partial SVG and final saved rendering has matching download', () => {
  const parent = document.createElement('div'), render = createMarkdownRenderer({ document });
  render(parent, '```svg\n' + drawing.slice(0, 80), [], [], { streaming: true });
  assert.match(parent.textContent, /Drawing your diagram/);
  assert.equal(parent.querySelectorAll('img,code').length, 0);
  render(parent, '```svg\n' + drawing + '\n```');
  assert.equal(parent.querySelector('img').alt, 'Client & hosts');
  assert.match(parent.querySelector('a').download, /\.svg$/);
  render(parent, '```svg\n' + drawing);
  assert.match(parent.textContent, /not completed/);
  assert.equal(parent.querySelectorAll('img').length, 0);
});
test('ordinary HTML remains text and uppercase/tilde svg fences render', () => {
  const parent = document.createElement('div'), render = createMarkdownRenderer({ document });
  render(parent, '<svg onload="bad"/>\n~~~SVG\n'+drawing+'\n~~~');
  assert.equal(parent.querySelectorAll('svg').length, 0);
  assert.equal(parent.querySelectorAll('img').length, 1);
});
test('expand, zoom, close remove dialog and restore focus', () => {
  const win = document.defaultView;
  win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  win.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new win.Event('close')); };
  const card = createSVGPreview(document, drawing);
  document.body.append(card);
  card.querySelector('button').click();
  const modal = document.querySelector('dialog');
  assert.equal(modal.open, true);
  modal.querySelector('[aria-label="Zoom in"]').click();
  modal.querySelector('[aria-label="Zoom in"]').click();
  assert.match(modal.querySelector('.svg-viewport').className, /svg-zoom-2/);
  [...modal.querySelectorAll('button')].find(b => b.textContent === 'Close').click();
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(document.activeElement, card.querySelector('button'));
  card.remove();
});
