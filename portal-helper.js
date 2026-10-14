/*!
 * Signage Portal Helper — ST59
 * ใช้บนหน้า Store Ops Portal › Print Signage (store-ops.cpaxtra.co.th/signage/print)
 * หลัง "Upload Excel" แล้ว สคริปต์จะไล่ตั้ง Template / Size (และ Copies ถ้าเลือก) ให้ทุกแถว
 * ตามข้อมูลคำขอที่ staff เลือกไว้ใน web app ของเรา
 *
 * ข้อมูลที่รับ (วางในช่องของแผง):
 *   - ข้อความคั่นด้วย Tab (copy จาก Excel / Google Sheet ได้เลย)  Article <Tab> Template <Tab> Size <Tab> Copies
 *   - หรือ JSON: [{"article":"198368","template":"Simple1","size":"A4","copies":1}, ...]
 * สคริปต์ไม่ส่งข้อมูลออกไปไหน ทำงานในหน้าเว็บนี้อย่างเดียว
 */
(function () {
  'use strict';
  if (window.__sgHelper) { window.__sgHelper.show(); return; }

  var SIZES = ['A3', 'A4', 'A5', 'A6'];
  var DELAY = 150;          // ms ระหว่างการคลิก
  var OPEN_TIMEOUT = 2000;  // ms รอ dropdown เปิด

  // ---------- utils ----------
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var txt = function (el) { return (el && el.textContent || '').replace(/\s+/g, ' ').trim(); };
  var normArt = function (s) { return String(s || '').replace(/\D/g, '').replace(/^0+/, ''); };
  // "Plain -BG (Plain)" -> "plain-bg" ; "Gone Forever - Simple" -> "gone forever-simple"
  var normTpl = function (s) {
    return String(s || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  };
  function visible(el) {
    if (!el || !el.getClientRects().length) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0;
  }
  function realClick(el) {
    var r = el.getBoundingClientRect();
    var o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'mouse', isPrimary: true }, o))); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mousedown', o));
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'mouse', isPrimary: true }, o))); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
  }
  function pressEsc() {
    var t = document.activeElement || document.body;
    ['keydown', 'keyup'].forEach(function (k) {
      t.dispatchEvent(new KeyboardEvent(k, { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    });
  }
  function setNativeValue(input, value) {
    var proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---------- parse input ----------
  function parseInput(raw) {
    raw = String(raw || '').trim();
    if (!raw) return [];
    var out = [];
    if (/^[\[{]/.test(raw)) {
      var j = JSON.parse(raw);
      if (!Array.isArray(j)) j = j.items || [j];
      j.forEach(function (i) {
        out.push({ article: normArt(i.article || i.Article), template: String(i.template || i.Template || '').trim(),
          size: String(i.size || i.Size || '').toUpperCase().trim(), copies: parseInt(i.copies || i.Copies, 10) || 0 });
      });
    } else {
      raw.split(/\r?\n/).forEach(function (line) {
        var cells = line.split(line.indexOf('\t') >= 0 ? '\t' : /\s*[|;]\s*/).map(function (c) { return c.trim(); });
        var art = '', tpl = '', size = '', copies = 0;
        cells.forEach(function (c) {
          if (!c) return;
          if (!art && /^\d{4,10}$/.test(c)) art = c;
          else if (!size && /^A[3-6]$/i.test(c)) size = c.toUpperCase();
          else if (!copies && /^\d{1,3}$/.test(c)) copies = parseInt(c, 10);
          else if (!tpl) tpl = c;
        });
        if (art) out.push({ article: normArt(art), template: tpl, size: size, copies: copies });
      });
    }
    return out.filter(function (i) { return i.article; });
  }

  // ---------- find rows on the portal ----------
  function sizeButtons(scope) {
    return Array.prototype.filter.call(scope.querySelectorAll('button,[role="button"],[role="radio"]'), function (b) {
      return SIZES.indexOf(txt(b).toUpperCase()) >= 0;
    });
  }
  var CHECKBOX = 'input[type="checkbox"],[role="checkbox"]';
  var ART_RE = /^\d{4,10}$/;
  function articleCount(el) {
    var c = 0, w = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
    while (w.nextNode()) { var e = w.currentNode; if (!e.children.length && ART_RE.test(txt(e))) c++; }
    return c;
  }
  // container ของแถว: <tr> ถ้ามี ไม่งั้นไต่ขึ้นไปจนเจอ checkbox ของแถว (มีทั้งตอนเลือกและยังไม่เลือก Template)
  function rowOf(n) {
    var tr = n.closest('tr');
    if (tr) return tr;
    var row = n.parentElement;
    for (var d = 0; row && d < 14; d++, row = row.parentElement) {
      if (row === document.body) return null;
      var cb = row.querySelectorAll(CHECKBOX).length;
      if (cb || sizeButtons(row).length) {
        return (cb <= 1 && sizeButtons(row).length <= 4 && articleCount(row) === 1) ? row : null;
      }
    }
    return null;
  }
  function findRows() {
    var root = document.querySelector('main') || document.body;
    var rows = [], seen = new Set();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      var n = walker.currentNode;
      if (n.children.length || !ART_RE.test(txt(n)) || n.closest('#sg-helper')) continue;
      var row = rowOf(n);
      if (!row || seen.has(row)) continue;
      seen.add(row);
      rows.push({ el: row, article: normArt(txt(n)), artEl: n });
    }
    return rows;
  }
  function isExtraWord(b) {
    for (var p = b.parentElement, d = 0; p && d < 3; p = p.parentElement, d++) {
      // กล่องเล็กที่มีแค่ label "Extra word" + ปุ่มนี้ปุ่มเดียว (ไม่ใช่ทั้งแถว)
      if (/extra word/i.test(txt(p))) {
        return p.querySelectorAll('button,select,[role="combobox"]').length === 1 && !/template/i.test(txt(b));
      }
    }
    return false;
  }
  function templateTrigger(row) {
    var best = null, bestScore = 0;
    Array.prototype.forEach.call(row.querySelectorAll('select,[role="combobox"],[aria-haspopup],button'), function (b) {
      if (!visible(b) || b.matches(CHECKBOX) || b.hasAttribute('aria-checked') || isExtraWord(b)) return;
      var t = txt(b);
      if (SIZES.indexOf(t.toUpperCase()) >= 0 || /^[+\-−–]?$/.test(t) || /^\d+$/.test(t) || /no template/i.test(t)) return;
      var s = 0;
      if (b.tagName === 'SELECT' || b.getAttribute('role') === 'combobox' || b.hasAttribute('aria-haspopup')) s += 2;
      if (/template/i.test(t)) s += 3;
      if (t && b.querySelector('svg')) s += 1;
      if (s > bestScore) { best = b; bestScore = s; }
    });
    return best;
  }
  function copiesControl(row) {
    var inp = row.querySelector('input[type="number"],input[inputmode="numeric"]');
    if (inp) return { input: inp };
    var nodes = Array.prototype.filter.call(row.querySelectorAll('span,div,p'), function (e) {
      return !e.children.length && /^\d{1,3}$/.test(txt(e)) && visible(e);
    });
    for (var i = 0; i < nodes.length; i++) {
      var box = nodes[i].parentElement;
      var btns = box && Array.prototype.filter.call(box.querySelectorAll('button'), visible);
      if (btns && btns.length >= 2) return { label: nodes[i], minus: btns[0], plus: btns[btns.length - 1] };
    }
    return null;
  }

  // ---------- actions ----------
  function findOption(name, trigger) {
    var want = normTpl(name);
    var pool = document.querySelectorAll('[role="option"],[role="menuitem"],[role="menuitemradio"],[cmdk-item],li,[data-value]');
    if (!pool.length) pool = document.querySelectorAll('div,span');
    var hit = null;
    Array.prototype.forEach.call(pool, function (o) {
      if (hit || !visible(o) || o === trigger || trigger.contains(o) || o.closest('#sg-helper')) return;
      if (o.children.length > 3) return;
      if (normTpl(txt(o)) === want) hit = o;
    });
    return hit;
  }
  function isDisabled(o) {
    if (o.getAttribute('aria-disabled') === 'true' || o.hasAttribute('data-disabled') || o.disabled) return true;
    var c = getComputedStyle(o);
    return c.pointerEvents === 'none' || c.cursor === 'not-allowed';
  }
  // สไตล์ของ template: ใช้จับคู่ข้ามประเภทสินค้า (Simple / Plain / FixedSlab / Complex ...)
  function themeOf(name) {
    var n = normTpl(name);
    if (/gone ?forever/.test(n)) return 'gone forever';
    if (/super ?hot ?deal/.test(n)) return 'super hot deal';
    if (/gold ?con/.test(n)) return 'gold con';
    if (/ไม่มีพื้นหลัง/.test(n)) return 'nobg';
    return 'base';
  }
  var OPT_SEL = '[role="option"],[role="menuitem"],[role="menuitemradio"],[cmdk-item]';
  function liveOption(o) {
    // ตัวเลือกของ dropdown ที่กำลังจางหาย (animation ตอนปิด) จะคลิกไม่ได้
    if (!visible(o)) return false;
    var c = o.closest('[data-state]');
    if (c && c.getAttribute('data-state') === 'closed') return false;
    return getComputedStyle(o).pointerEvents !== 'none' || o.getAttribute('aria-disabled') === 'true';
  }
  function allOptions() {
    return Array.prototype.filter.call(document.querySelectorAll(OPT_SEL), function (o) {
      return visible(o) && !o.closest('#sg-helper');
    });
  }
  function listOptions(trig) {
    var id = trig.getAttribute('aria-controls'), box = id && document.getElementById(id);
    var src = box ? box.querySelectorAll(OPT_SEL) : document.querySelectorAll(OPT_SEL);
    return Array.prototype.filter.call(src, function (o) {
      return liveOption(o) && !trig.contains(o) && !o.closest('#sg-helper');
    });
  }
  async function waitAllClosed(ms) {
    var t0 = Date.now();
    while (allOptions().length && Date.now() - t0 < ms) await sleep(60);
    return !allOptions().length;
  }
  function dropdownOpen(trig) {
    return listOptions(trig).length > 0 || trig.getAttribute('aria-expanded') === 'true';
  }
  async function closeDropdown(trig) {
    if (!dropdownOpen(trig)) return;
    var opts = listOptions(trig);
    var targets = [opts[0], opts[0] && opts[0].parentElement, document.activeElement, trig, document].filter(Boolean);
    targets.forEach(function (t) {
      ['keydown', 'keyup'].forEach(function (k) {
        t.dispatchEvent(new KeyboardEvent(k, { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
      });
    });
    await sleep(DELAY);
    if (trig.isConnected && trig.getAttribute('aria-expanded') === 'true') { realClick(trig); await sleep(DELAY); } // ปิดด้วยการกดซ้ำ เฉพาะเมื่อปุ่มบอกว่าเปิดอยู่
    if (dropdownOpen(trig)) {                                                // คลิกที่ว่างนอก dropdown
      var o = { bubbles: true, cancelable: true, view: window, clientX: 5, clientY: 5 };
      try { document.body.dispatchEvent(new PointerEvent('pointerdown', o)); } catch (e) {}
      document.body.dispatchEvent(new MouseEvent('mousedown', o));
      document.body.dispatchEvent(new MouseEvent('click', o));
      await sleep(DELAY);
    }
  }
  async function waitOptions(trig, ms) {
    var t0 = Date.now(), o = [];
    do { await sleep(80); o = listOptions(trig); } while (!o.length && Date.now() - t0 < ms);
    return o;
  }
  function key(t, k, code) {
    ['keydown', 'keyup'].forEach(function (type) {
      t.dispatchEvent(new KeyboardEvent(type, { key: k, code: code, keyCode: k === 'Enter' ? 13 : k === ' ' ? 32 : 40, bubbles: true, cancelable: true }));
    });
  }
  // เปิด dropdown: คลิกก่อน ถ้าไม่เปิดลองคีย์บอร์ด (ลูกศรลง / Enter / Space)
  async function openDropdown(trig) {
    realClick(trig);
    var o = await waitOptions(trig, 700);
    if (o.length) return o;
    var tries = [['ArrowDown', 'ArrowDown'], ['Enter', 'Enter'], [' ', 'Space']];
    for (var i = 0; i < tries.length && !o.length; i++) {
      if (trig.getAttribute('aria-expanded') === 'true') break;
      try { trig.focus(); } catch (e) {}
      key(trig, tries[i][0], tries[i][1]);
      o = await waitOptions(trig, 600);
    }
    return o.length ? o : await waitOptions(trig, OPEN_TIMEOUT);
  }
  function currentTpl(trig) {
    return trig.tagName === 'SELECT' ? (trig.options[trig.selectedIndex] || {}).text : txt(trig);
  }
  // คืนค่า { err, note }
  async function setTemplateOnce(row, name) {
    var trig = templateTrigger(row.el);
    if (!trig) return { err: 'หา dropdown Template ไม่เจอ' };
    if (normTpl(currentTpl(trig)) === normTpl(name)) return {};
    var want = normTpl(name), theme = themeOf(name), opts, pick = null, note = '';

    if (trig.tagName === 'SELECT') {
      opts = Array.prototype.slice.call(trig.options).map(function (o) { return { el: o, text: o.text, disabled: o.disabled }; });
    } else {
      await closeDropdown(trig);
      if (!(await waitAllClosed(1200))) { pressEsc(); await waitAllClosed(800); }
      opts = await openDropdown(trig);
      if (!opts.length) {                    // ไม่ใช้ role=option -> หาแบบข้อความตรงตัว
        var f = findOption(name, trig);
        opts = f ? [f] : [];
      }
      opts = opts.map(function (o) { return { el: o, text: txt(o), disabled: isDisabled(o) }; });
    }
    var enabled = opts.filter(function (o) { return !o.disabled; });
    pick = enabled.find(function (o) { return normTpl(o.text) === want; });
    if (!pick) {
      // ชื่อตรงใช้ไม่ได้กับประเภทสินค้านี้ -> เลือกสไตล์เดียวกันจากกลุ่ม Matching
      pick = enabled.find(function (o) { return themeOf(o.text) === theme; });
      if (pick) note = name + ' → ' + pick.text.replace(/\s*\([^)]*\)\s*$/, '');
    }
    if (!pick) {
      if (trig.tagName !== 'SELECT') await closeDropdown(trig);
      var have = enabled.map(function (o) { return o.text; }).join(', ');
      return { err: 'ไม่มีสไตล์ "' + name + '" สำหรับสินค้านี้' + (have ? ' (มี: ' + have + ')' : '') };
    }
    if (trig.tagName === 'SELECT') { setNativeValue(trig, pick.el.value); await sleep(DELAY); }
    else {
      pick.el.scrollIntoView({ block: 'nearest' });
      realClick(pick.el);
      await sleep(DELAY + 150);
      if (trig.isConnected && normTpl(currentTpl(trig)) !== normTpl(pick.text) && pick.el.isConnected && visible(pick.el)) {
        // สำรอง: ชี้เมาส์ที่ตัวเลือกแล้วกด Enter
        ['pointerover', 'pointermove', 'mouseover', 'mousemove'].forEach(function (t) {
          try { pick.el.dispatchEvent(new (t.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(t, { bubbles: true, pointerType: 'mouse' })); } catch (e) {}
        });
        try { pick.el.focus(); } catch (e) {}
        key(pick.el, 'Enter', 'Enter');
        await sleep(DELAY + 150);
      }
      await closeDropdown(trig);
    }
    var fr = function () {                        // ปุ่มอาจถูกวาดใหม่ -> หาใหม่จากแถวล่าสุด
      if (trig.isConnected) return trig;
      var rr = findRows().filter(function (x) { return x.article === row.article; });
      var me = rr[row.occ || 0];
      return (me && templateTrigger(me.el)) || trig;
    };
    trig = fr();
    if (normTpl(currentTpl(trig)) !== normTpl(pick.text)) {
      await sleep(300); trig = fr();
      if (normTpl(currentTpl(trig)) !== normTpl(pick.text)) return { err: 'คลิกแล้วแต่ Template ยังไม่เปลี่ยน', note: note };
    }
    return { note: note };
  }
  async function setTemplate(row, name) {
    var r = await setTemplateOnce(row, name);
    if (r.err && /ยังไม่เปลี่ยน|หาไม่เจอ/.test(r.err)) {        // ลองซ้ำอีกครั้ง
      await sleep(400);
      var r2 = await setTemplateOnce(row, name);
      if (!r2.err) return r2;
    }
    return r;
  }
  async function setSize(row, size) {
    // ปุ่มขนาดจะโผล่หลังเลือก Template แล้วเท่านั้น -> รอสักครู่
    var b = null, t0 = Date.now();
    while (!b && Date.now() - t0 < OPEN_TIMEOUT) {
      b = sizeButtons(row().el).find(function (x) { return txt(x).toUpperCase() === size; });
      if (!b) await sleep(100);
    }
    if (!b) return 'ไม่มีขนาด ' + size + (sizeButtons(row().el).length ? '' : ' (ยังไม่ได้เลือก Template?)');
    realClick(b); await sleep(DELAY); return '';
  }
  async function setCopies(row, n) {
    var c = copiesControl(row().el);
    if (!c) return 'หาช่อง Copies ไม่เจอ';
    if (c.input) { setNativeValue(c.input, String(n)); await sleep(DELAY); return ''; }
    for (var guard = 0; guard < 100; guard++) {
      var cur = parseInt(txt(c.label), 10);
      if (cur === n) return '';
      realClick(cur < n ? c.plus : c.minus); await sleep(60);
      c = copiesControl(row().el) || c;
    }
    return 'ตั้ง Copies ไม่สำเร็จ';
  }

  // ---------- UI ----------
  var ui = {};
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (k) { e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return e;
  }
  function log(msg, kind) {
    var li = h('li', { style: 'padding:2px 0;color:' + (kind === 'err' ? '#c1121f' : kind === 'ok' ? '#2b7a3d' : '#333') }, [msg]);
    ui.log.appendChild(li); ui.log.scrollTop = ui.log.scrollHeight;
  }
  function buildUI() {
    var btn = 'border:1px solid #ccd;border-radius:8px;padding:7px 12px;font:600 13px sans-serif;cursor:pointer;background:#fff';
    ui.box = h('div', { id: 'sg-helper', style: 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:380px;max-height:80vh;display:flex;flex-direction:column;gap:8px;background:#fff;border:1px solid #d5d9e3;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.18);padding:14px;font:13px/1.45 sans-serif;color:#14213d' });
    var close = h('button', { style: 'border:0;background:none;font-size:18px;cursor:pointer;margin-left:auto' }, ['×']);
    close.onclick = function () { ui.box.style.display = 'none'; };
    ui.box.appendChild(h('div', { style: 'display:flex;align-items:center;gap:8px' }, [h('b', { style: 'font-size:15px' }, ['⚙ ตั้งค่าป้ายอัตโนมัติ · ST59']), close]));
    ui.box.appendChild(h('div', { style: 'color:#667' }, ['วางข้อมูล Article · Template · Size · Copies (copy จาก Excel หรือปุ่มในหน้า Admin)']));
    ui.ta = h('textarea', { rows: '6', placeholder: '198368\tSimple1\tA4\t1', style: 'width:100%;box-sizing:border-box;font:12px monospace;border:1px solid #ccd;border-radius:8px;padding:6px;resize:vertical' });
    ui.box.appendChild(ui.ta);
    ui.cp = h('input', { type: 'checkbox', id: 'sg-cp' });
    ui.box.appendChild(h('label', { for: 'sg-cp', style: 'display:flex;gap:6px;align-items:center' }, [ui.cp, 'ตั้ง Copies ด้วย (ปกติมาจาก Excel แล้ว)']));
    var bPaste = h('button', { style: btn }, ['📋 วาง']);
    var bCheck = h('button', { style: btn }, ['🔍 ตรวจหน้า']);
    ui.run = h('button', { style: btn + ';background:#1f6feb;color:#fff;border-color:#1f6feb' }, ['▶ เริ่มตั้งค่า']);
    var bDiag = h('button', { style: btn, title: 'เก็บโครงสร้าง dropdown ไว้ส่งผู้ดูแล' }, ['🧪']);
    bDiag.onclick = diagnose;
    ui.box.appendChild(h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [bPaste, bCheck, ui.run, bDiag]));
    ui.log = h('ol', { style: 'margin:0;padding:0 0 0 18px;overflow:auto;max-height:34vh;border-top:1px solid #eef;padding-top:6px' });
    ui.box.appendChild(ui.log);
    document.body.appendChild(ui.box);

    bPaste.onclick = function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) { ui.ta.focus(); log('เบราว์เซอร์ไม่ให้อ่านคลิปบอร์ด — กด Ctrl+V ในช่องแทน'); return; }
      navigator.clipboard.readText().then(function (t) { ui.ta.value = t; check(); }, function () { ui.ta.focus(); log('อ่านคลิปบอร์ดไม่ได้ — กด Ctrl+V ในช่องแทน'); });
    };
    bCheck.onclick = check;
    ui.run.onclick = run;
  }

  function plan() {
    var data;
    try { data = parseInput(ui.ta.value); } catch (e) { log('อ่านข้อมูลไม่ได้: ' + e.message, 'err'); return null; }
    var rows = findRows();
    var queue = {};
    data.forEach(function (d) { (queue[d.article] = queue[d.article] || []).push(d); });
    var pairs = [], noData = [], seenArt = {};
    rows.forEach(function (r) {
      var q = queue[r.article];
      seenArt[r.article] = (seenArt[r.article] || 0) + 1;
      if (q && q.length) pairs.push({ row: r, occ: seenArt[r.article] - 1, want: q.shift() }); else noData.push(r.article);
    });
    var notOnPage = [];
    Object.keys(queue).forEach(function (a) { queue[a].forEach(function () { notOnPage.push(a); }); });
    return { data: data, rows: rows, pairs: pairs, noData: noData, notOnPage: notOnPage };
  }
  function check() {
    ui.log.textContent = '';
    var p = plan(); if (!p) return null;
    log('ข้อมูลที่วาง: ' + p.data.length + ' รายการ · แถวบนหน้าเว็บ: ' + p.rows.length + ' แถว');
    log('จับคู่ได้ ' + p.pairs.length + ' แถว', p.pairs.length ? 'ok' : 'err');
    if (p.rows.length && !templateTrigger(p.rows[0].el)) log('⚠ แถวแรกหา dropdown Template ไม่เจอ — ส่งภาพ Inspect ให้ผู้ดูแล', 'err');
    if (p.notOnPage.length) log('ไม่มีบนหน้าเว็บ (ยังไม่ได้ Upload?): ' + p.notOnPage.join(', '), 'err');
    if (p.noData.length) log('บนหน้าเว็บแต่ไม่มีในข้อมูล (จะไม่แตะ): ' + p.noData.join(', '));
    return p;
  }
  function brief(el, n) {
    if (!el) return '(none)';
    var c = el.cloneNode(false), h = c.outerHTML;
    return (h.length > (n || 260) ? h.slice(0, n || 260) + '…' : h) + ' text="' + txt(el).slice(0, 40) + '"';
  }
  async function diagnose() {
    ui.log.textContent = '';
    var rows = findRows(), out = ['== Signage helper diag ==', 'rows: ' + rows.length + ' · ' + location.pathname];
    var row = rows.find(function (r) { return /select template/i.test(txt(templateTrigger(r.el))); }) || rows[1] || rows[0];
    if (!row) { log('ไม่เจอแถว', 'err'); return; }
    var trig = templateTrigger(row.el);
    out.push('row ' + row.article + ': ' + brief(row.el, 200));
    out.push('trigger: ' + brief(trig, 400));
    if (trig) {
      out.push('trigger parent: ' + brief(trig.parentElement, 200));
      out.push('before: expanded=' + trig.getAttribute('aria-expanded') + ' options=' + allOptions().length);
      realClick(trig); var o = await waitOptions(trig, 900);
      out.push('after click: expanded=' + trig.getAttribute('aria-expanded') + ' live=' + o.length + ' all=' + allOptions().length + ' bodyPE=' + getComputedStyle(document.body).pointerEvents);
      if (!o.length) {
        try { trig.focus(); } catch (e) {}
        key(trig, 'ArrowDown', 'ArrowDown'); o = await waitOptions(trig, 700);
        out.push('after ArrowDown: expanded=' + trig.getAttribute('aria-expanded') + ' live=' + o.length);
      }
      var any = allOptions();
      if (any[0]) {
        out.push('option[0]: ' + brief(any[0], 300) + ' pe=' + getComputedStyle(any[0]).pointerEvents);
        out.push('option parent: ' + brief(any[0].parentElement, 200));
        out.push('popup: ' + brief(any[0].closest('[role="listbox"],[role="menu"],[data-radix-popper-content-wrapper],[data-state]'), 300));
      } else {
        var opens = document.querySelectorAll('[data-state="open"],[aria-expanded="true"],[role="listbox"],[role="menu"]');
        out.push('open-ish elements: ' + opens.length);
        Array.prototype.slice.call(opens, 0, 3).forEach(function (e) { out.push('  ' + brief(e, 250)); });
      }
      await closeDropdown(trig);
    }
    var text = out.join('\n');
    ui.ta.value = text; ui.ta.select();
    try { await navigator.clipboard.writeText(text); log('คัดลอกผลวินิจฉัยแล้ว — วางส่งให้ผู้ดูแลได้เลย', 'ok'); }
    catch (e) { log('ผลวินิจฉัยอยู่ในช่องข้อความ (เลือกไว้แล้ว) — กด Ctrl+C แล้วส่งให้ผู้ดูแล', 'ok'); }
  }
  var running = false;
  async function run() {
    if (running) return;
    var p = check(); if (!p || !p.pairs.length) return;
    running = true; ui.run.disabled = true;
    var ok = 0, fail = 0, swapped = 0;
    for (var i = 0; i < p.pairs.length; i++) {
      var pr = p.pairs[i], w = pr.want, errs = [];
      ui.run.textContent = '⏳ ' + (i + 1) + '/' + p.pairs.length;
      // หน้าเว็บวาดแถวใหม่ทุกครั้งที่เปลี่ยนค่า -> ใช้ element ล่าสุดเสมอ
      var cur = (function (pr) {
        return function () {
          var f = findRows().filter(function (r) { return r.article === pr.want.article; })[pr.occ];
          if (f) { f.occ = pr.occ; pr.row = f; }
          return pr.row;
        };
      })(pr);
      cur();
      pr.row.el.scrollIntoView({ block: 'center' });
      await sleep(DELAY);
      try {
        if (w.template) {
          var r1 = await setTemplate(pr.row, w.template);
          if (r1.err) errs.push(r1.err + (r1.note ? ' [' + r1.note + ']' : '')); else if (r1.note) { swapped++; log(w.article + ' ↺ ' + r1.note + ' (ประเภทสินค้าไม่ตรง)'); }
        }
        if (w.size && !errs.length) { var e2 = await setSize(cur, w.size); if (e2) errs.push(e2); }
        if (ui.cp.checked && w.copies) { var e3 = await setCopies(cur, w.copies); if (e3) errs.push(e3); }
      } catch (e) { errs.push('ผิดพลาด: ' + e.message); pressEsc(); }
      var tg = templateTrigger(cur().el); if (tg) await closeDropdown(tg);
      await waitAllClosed(1000);
      cur();
      if (errs.length) { fail++; log(w.article + ' ✗ ' + errs.join(' · '), 'err'); pr.row.el.style.outline = '3px solid #e63946'; }
      else { ok++; pr.row.el.style.outline = ''; }
    }
    log('เสร็จ ✓ ' + ok + ' แถว' + (swapped ? ' (สลับสไตล์อัตโนมัติ ' + swapped + ')' : '') + (fail ? ' · ✗ ' + fail + ' แถว (กรอบแดง ต้องแก้เอง)' : ''), fail ? 'err' : 'ok');
    log('ตรวจความถูกต้องก่อนกด Print All ทุกครั้ง');
    ui.run.textContent = '▶ เริ่มตั้งค่า'; ui.run.disabled = false; running = false;
  }

  buildUI();
  window.__sgHelper = { show: function () { ui.box.style.display = 'flex'; }, parse: parseInput, rows: findRows };
})();
