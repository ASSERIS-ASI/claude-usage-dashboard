/**
 * @asseris-module       Cache Files Explorer
 * @asseris-description  Auto-annotated module metadata for public/js/cache-files-explorer.js.
 * @asseris-pillar       actuator
 * @asseris-domain       dashboard-ui
 * @asseris-stage        output
 */
/**
 * Cache-Dateien-Explorer (Modal: Baum + Filter + Preview).
 * Lädt GET /api/debug/cache-files, Preview POST /api/debug/cache-file-view (dev_only).
 * Referenz: window.CacheFilesExplorer.wireOpenButton("dev-cache-files-open")
 */
(function (global) {

  // ── JSON Tree Viewer with collapsible nodes ──────────────────────
  function buildJsonTree(val, depth, startOpen) {
    if (depth > 20) { var sToo = document.createElement('span'); sToo.className = 'jt-val'; sToo.textContent = '…'; return sToo; }
    if (val === null) { var sN = document.createElement('span'); sN.className = 'jt-null'; sN.textContent = 'null'; return sN; }
    if (typeof val === 'boolean') { var sB = document.createElement('span'); sB.className = 'jt-bool'; sB.textContent = String(val); return sB; }
    if (typeof val === 'number') { var sNu = document.createElement('span'); sNu.className = 'jt-num'; sNu.textContent = String(val); return sNu; }
    if (typeof val === 'string') { var sS = document.createElement('span'); sS.className = 'jt-str'; sS.textContent = '"' + val.slice(0, 500) + (val.length > 500 ? '…' : '') + '"'; return sS; }
    var isArr = Array.isArray(val);
    var keys = isArr ? null : Object.keys(val);
    var len = isArr ? val.length : keys.length;
    var wrap = document.createElement('span');
    wrap.className = 'jt-node';
    var toggle = document.createElement('span');
    toggle.className = 'jt-toggle';
    var open = startOpen && depth < 1;
    toggle.textContent = open ? '▼' : '▶';
    var summary = document.createElement('span');
    summary.className = 'jt-summary';
    summary.textContent = isArr ? '[' + len + ']' : '{' + len + '}';
    var children = document.createElement('div');
    children.className = 'jt-children';
    children.style.display = open ? '' : 'none';
    toggle.addEventListener('click', function () {
      var showing = children.style.display !== 'none';
      children.style.display = showing ? 'none' : '';
      toggle.textContent = showing ? '▶' : '▼';
      // Lazy build children on first open
      if (!showing && !children.dataset.built) {
        children.dataset.built = '1';
        populateChildren(children, val, isArr, keys, depth);
      }
    });
    wrap.appendChild(toggle);
    wrap.appendChild(summary);
    wrap.appendChild(children);
    if (open) { children.dataset.built = '1'; populateChildren(children, val, isArr, keys, depth); }
    return wrap;
  }

  function populateChildren(container, val, isArr, keys, depth) {
    var entries = isArr ? val : keys;
    var max = Math.min(entries.length, 500);
    for (var i = 0; i < max; i++) {
      var row = document.createElement('div');
      row.className = 'jt-row';
      var key = document.createElement('span');
      key.className = 'jt-key';
      key.textContent = isArr ? '[' + i + ']' : entries[i];
      row.appendChild(key);
      var sep = document.createElement('span');
      sep.className = 'jt-sep';
      sep.textContent = ': ';
      row.appendChild(sep);
      var child = isArr ? val[i] : val[entries[i]];
      row.appendChild(buildJsonTree(child, depth + 1, false));
      container.appendChild(row);
    }
    if (entries.length > max) {
      var more = document.createElement('div');
      more.className = 'jt-row jt-more';
      more.textContent = '… ' + (entries.length - max) + ' more';
      container.appendChild(more);
    }
  }

  function parseJsonEvidence(raw) {
    try {
      return { value: JSON.parse(raw), ndjson: false, skipped: 0 };
    } catch (error) { /* JSONL/NDJSON falls through */ }
    var lines = String(raw || '').split(/\r?\n/);
    var records = [];
    var skipped = 0;
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line || line.startsWith('... [truncated')) continue;
      try {
        records.push(JSON.parse(line));
      } catch (error) {
        skipped++;
      }
    }
    if (!records.length) return null;
    return { value: records, ndjson: true, skipped: skipped };
  }

  function renderJsonEvidence(pre, parsed, meta) {
    pre.replaceChildren(buildJsonTree(parsed.value, 0, true));
    if (parsed.ndjson || meta.truncated || parsed.skipped) {
      var note = document.createElement('div');
      note.className = 'jt-more';
      var parts = [];
      if (parsed.ndjson) parts.push(parsed.value.length + ' NDJSON records');
      if (parsed.skipped) parts.push(parsed.skipped + ' incomplete lines skipped');
      if (meta.truncated) parts.push((meta.size / 1024 / 1024).toFixed(1) + ' MB total; preview truncated');
      note.textContent = parts.join(' · ');
      pre.appendChild(note);
    }
  }

  var sharedCacheModalEl = null;
  function wireOpenButton(buttonId) {
    var openBtn = document.getElementById(buttonId || "dev-cache-files-open");
    if (!openBtn) return;
    if (openBtn.getAttribute("data-cache-explorer-wired")) return;
    openBtn.setAttribute("data-cache-explorer-wired", "1");
    function resetCacheDialogLayout() {
      var dlg = sharedCacheModalEl ? sharedCacheModalEl.querySelector(".dev-cache-files-modal-dialog") : null;
      if (!dlg) return;
      dlg.style.position = "";
      dlg.style.left = "";
      dlg.style.top = "";
      dlg.style.margin = "";
      dlg.classList.remove("dev-cache-files-modal-dialog--dragging");
    }
    function setLoadStatus(text) {
      var s = document.getElementById("dev-cache-files-load-status");
      if (s) s.textContent = text || "";
    }
    function collapseEmptyDetails() {
      var acc = document.getElementById("dev-cache-files-accordion");
      if (!acc) return;
      function depthOf(el) {
        var d = 0;
        var p = el;
        while (p && p !== acc) {
          if (p.nodeName === "DETAILS") d++;
          p = p.parentElement;
        }
        return d;
      }
      var arr = Array.prototype.slice.call(acc.querySelectorAll("details.dev-cache-folder"));
      arr.sort(function (a, b) {
        return depthOf(b) - depthOf(a);
      });
      for (var i = 0; i < arr.length; i++) {
        var det = arr[i];
        var trs = det.querySelectorAll("tbody tr");
        var anyTr = false;
        for (var t = 0; t < trs.length; t++) {
          if (trs[t].style.display !== "none") {
            anyTr = true;
            break;
          }
        }
        var body = det.querySelector(".dev-cache-folder-body");
        var anyChild = false;
        if (body) {
          for (var c = 0; c < body.children.length; c++) {
            var ch = body.children[c];
            if (ch.nodeName === "DETAILS" && ch.style.display !== "none") {
              anyChild = true;
              break;
            }
          }
        }
        det.style.display = anyTr || anyChild ? "" : "none";
      }
    }
    function onFilterInput() {
      var inp = document.getElementById("dev-cache-files-filter");
      var q = (inp && String(inp.value).toLowerCase().trim()) || "";
      var acc = document.getElementById("dev-cache-files-accordion");
      if (!acc) return;
      var rowsAll = acc.querySelectorAll("tbody tr");
      for (var ri = 0; ri < rowsAll.length; ri++) {
        var row = rowsAll[ri];
        var hay = String(row.getAttribute("data-search") || "").toLowerCase();
        var show = !q || hay.includes(q);
        row.style.display = show ? "" : "none";
      }
      collapseEmptyDetails();
    }
    function formatBytes(n) {
      if (n >= 1048576) return (n / 1048576).toFixed(2) + " MiB";
      if (n >= 1024) return (n / 1024).toFixed(1) + " KiB";
      return String(n) + " B";
    }
    function appendFileRowToTbody(tbody, f) {
      var tr = document.createElement("tr");
      var searchHay =
        (f.kind || "") +
        " " +
        (f.label || "") +
        " " +
        (f.file_name || "") +
        " " +
        (f.path_ui || "") +
        " " +
        (f.folder_ui || "");
      tr.setAttribute("data-search", searchHay);
      function tdText(txt) {
        var x = document.createElement("td");
        x.textContent = txt;
        return x;
      }
      tr.appendChild(tdText(f.kind || ""));
      tr.appendChild(tdText(f.label != null && String(f.label) !== "" ? String(f.label) : "\u2014"));
      var tdFile = document.createElement("td");
      tdFile.className = "dev-cache-file-cell";
      tdFile.title = f.path_ui || "";
      tdFile.textContent =
        f.file_name != null && String(f.file_name) !== "" ? String(f.file_name) : "(?)";
      tr.appendChild(tdFile);
      var tdSz = document.createElement("td");
      tdSz.textContent = formatBytes(f.size || 0);
      tr.appendChild(tdSz);
      var tdMt = document.createElement("td");
      tdMt.textContent = new Date(f.mtime_ms || 0).toLocaleString();
      tr.appendChild(tdMt);
      var tdAct = document.createElement("td");
      var bt = document.createElement("button");
      bt.type = "button";
      bt.className = "dev-cache-rebuild-btn dev-cache-view-btn";
      bt.textContent = "Ansehen";
      bt.setAttribute("data-path-enc", encodeURIComponent(f.path_abs));
      tdAct.appendChild(bt);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    }
    function newTreeNode() {
      return { children: Object.create(null), files: [] };
    }
    function folderSegs(folderUi) {
      var s = String(folderUi || "").replaceAll("\\", "/").trim();
      if (!s) return ["(?)"];
      var parts = s.split("/");
      var out = [];
      for (var pi = 0; pi < parts.length; pi++) {
        if (parts[pi]) out.push(parts[pi]);
      }
      return out.length ? out : ["(?)"];
    }
    function parentPathUiForTree(f) {
      var ui = String(f.path_ui || "").replaceAll("\\", "/").trim();
      var fn = String(f.file_name || "").trim();
      if (ui) {
        if (fn) {
          var lowUi = ui.toLowerCase();
          var lowFn = fn.toLowerCase();
          if (lowUi.length >= lowFn.length && lowUi.slice(lowUi.length - lowFn.length) === lowFn) {
            var cut = ui.length - fn.length;
            if (cut > 0 && ui.charAt(cut - 1) === "/") {
              return ui.slice(0, cut - 1);
            }
            if (cut === 0) {
              return "";
            }
          }
        }
        var slash = ui.lastIndexOf("/");
        if (slash > 0) {
          return ui.slice(0, slash);
        }
        if (slash === 0 && ui.length > 1) {
          return "";
        }
      }
      return String(f.folder_ui || "").replaceAll("\\", "/").trim();
    }
    function treeSegsForFile(f) {
      var seg0 = String(f.kind || "cache").replaceAll("/", "_");
      var parentPath = parentPathUiForTree(f);
      var out = [seg0];
      if (!parentPath) {
        return out;
      }
      var pathSegs = folderSegs(parentPath);
      for (var qi = 0; qi < pathSegs.length; qi++) {
        out.push(pathSegs[qi]);
      }
      return out;
    }
    function countFilesInTree(node) {
      var c = node.files.length;
      for (var k in node.children) {
        if (Object.hasOwn(node.children, k)) {
          c += countFilesInTree(node.children[k]);
        }
      }
      return c;
    }
    function insertFileIntoTree(root, file) {
      var segs = treeSegsForFile(file);
      var cur = root;
      for (var si = 0; si < segs.length; si++) {
        var seg = segs[si];
        if (!cur.children[seg]) cur.children[seg] = newTreeNode();
        cur = cur.children[seg];
      }
      cur.files.push(file);
    }
    function appendTableForFiles(host, list) {
      list.sort(function (a, b) {
        var na = String(a.file_name || "").toLowerCase();
        var nb = String(b.file_name || "").toLowerCase();
        return na < nb ? -1 : na > nb ? 1 : 0;
      });
      var tbl = document.createElement("table");
      tbl.className = "dev-cache-subtable";
      var thead = document.createElement("thead");
      var hr = document.createElement("tr");
      var heads = ["Kind", "Label", "Datei", "Bytes", "Geaendert", "Aktion"];
      for (var hi = 0; hi < heads.length; hi++) {
        var th = document.createElement("th");
        th.textContent = heads[hi];
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      tbl.appendChild(thead);
      var tbod = document.createElement("tbody");
      for (var ji = 0; ji < list.length; ji++) appendFileRowToTbody(tbod, list[ji]);
      tbl.appendChild(tbod);
      host.appendChild(tbl);
    }
    function renderTree(node, host) {
      var keys = Object.keys(node.children).sort();
      for (var ki = 0; ki < keys.length; ki++) {
        var gkey = keys[ki];
        var ch = node.children[gkey];
        var det = document.createElement("details");
        det.className = "dev-cache-folder";
        det.open = true;
        var sum = document.createElement("summary");
        sum.className = "dev-cache-folder-summary";
        sum.textContent = gkey + " (" + countFilesInTree(ch) + ")";
        det.appendChild(sum);
        var fbody = document.createElement("div");
        fbody.className = "dev-cache-folder-body";
        renderTree(ch, fbody);
        det.appendChild(fbody);
        host.appendChild(det);
      }
      if (node.files.length) appendTableForFiles(host, node.files);
    }
    function buildFolderTree(files) {
      var acc = document.getElementById("dev-cache-files-accordion");
      if (!acc) return;
      acc.innerHTML = "";
      var root = newTreeNode();
      for (var fi = 0; fi < files.length; fi++) insertFileIntoTree(root, files[fi]);
      renderTree(root, acc);
    }
    function ensureModal() {
      if (sharedCacheModalEl) return sharedCacheModalEl;
      var wrap = document.createElement("div");
      wrap.id = "dev-cache-files-modal";
      wrap.className = "dev-cache-files-modal";
      wrap.style.display = "none";
      wrap.setAttribute("aria-hidden", "true");
      wrap.innerHTML =
        '<div class="dev-cache-files-modal-backdrop" id="dev-cache-files-backdrop"></div>' +
        '<div class="dev-cache-files-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="dev-cache-files-title">' +
        '<div class="dev-cache-files-modal-head">' +
        '<span id="dev-cache-files-title" class="dev-cache-files-modal-title">Cache-Dateien</span>' +
        '<span id="dev-cache-files-load-status" class="dev-cache-meta"></span>' +
        '<button type="button" class="dev-cache-rebuild-btn" id="dev-cache-files-close">Schliessen</button>' +
        "</div>" +
        '<div class="dev-cache-files-main-row">' +
        '<div class="dev-cache-files-left">' +
        '<p class="dev-cache-files-modal-hint">Explorer-Baum: Kind, dann Pfadsegmente. Suchfeld filtert Zeilen.</p>' +
        '<input type="search" id="dev-cache-files-filter" class="dev-cache-files-filter" placeholder="Filter (Name, Pfad, Kind) …" autocomplete="off" />' +
        '<div id="dev-cache-files-accordion" class="dev-cache-files-accordion"></div>' +
        "</div>" +
        '<div id="dev-cache-file-preview" class="dev-cache-file-preview">' +
        '<div class="dev-cache-file-preview-head">' +
        '<span id="dev-cache-preview-title" class="dev-cache-meta"></span>' +
        '<button type="button" class="dev-cache-rebuild-btn" id="dev-cache-preview-close">Preview zu</button>' +
        "</div>" +
        '<div id="dev-cache-preview-empty" class="dev-cache-preview-empty">Datei waehlen: Ansehen in der Tabelle.</div>' +
        '<pre id="dev-cache-preview-body" class="dev-cache-preview-pre"></pre>' +
        "</div>" +
        "</div>" +
        "</div>";
      document.body.appendChild(wrap);
      sharedCacheModalEl = wrap;
      (function wireCacheModalDrag() {
        var dlg = wrap.querySelector(".dev-cache-files-modal-dialog");
        var head = wrap.querySelector(".dev-cache-files-modal-head");
        if (!dlg || !head) return;
        var drag = { active: false, sx: 0, sy: 0, ox: 0, oy: 0 };
        function onMove(ev) {
          if (!drag.active) return;
          var nx = drag.ox + (ev.clientX - drag.sx);
          var ny = drag.oy + (ev.clientY - drag.sy);
          var vw = window.innerWidth || 800;
          var vh = window.innerHeight || 600;
          var dw = dlg.offsetWidth || 400;
          var dh = dlg.offsetHeight || 300;
          var pad = 12;
          var minX = pad - dw + 48;
          var maxX = vw - 48;
          var minY = pad;
          var maxY = vh - 48;
          if (nx < minX) nx = minX;
          if (nx > maxX) nx = maxX;
          if (ny < minY) ny = minY;
          if (ny > maxY) ny = maxY;
          dlg.style.left = nx + "px";
          dlg.style.top = ny + "px";
        }
        function onUp() {
          drag.active = false;
          dlg.classList.remove("dev-cache-files-modal-dialog--dragging");
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        }
        head.addEventListener("mousedown", function (ev) {
          if (ev.button !== 0) return;
          if (ev.target && ev.target.closest && ev.target.closest("button")) return;
          var r = dlg.getBoundingClientRect();
          if (dlg.style.position !== "absolute") {
            dlg.style.position = "absolute";
            dlg.style.left = r.left + "px";
            dlg.style.top = r.top + "px";
            dlg.style.margin = "0";
          }
          drag.active = true;
          drag.sx = ev.clientX;
          drag.sy = ev.clientY;
          drag.ox = Number.parseFloat(dlg.style.left) || r.left;
          drag.oy = Number.parseFloat(dlg.style.top) || r.top;
          dlg.classList.add("dev-cache-files-modal-dialog--dragging");
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
          try {
            ev.preventDefault();
          } catch (error) { /* intentional */ }
        });
      })();
      document.getElementById("dev-cache-files-backdrop").addEventListener("click", closeModal);
      document.getElementById("dev-cache-files-close").addEventListener("click", closeModal);
      document.getElementById("dev-cache-preview-close").addEventListener("click", function () {
        var pr = document.getElementById("dev-cache-file-preview");
        var pre = document.getElementById("dev-cache-preview-body");
        var title = document.getElementById("dev-cache-preview-title");
        if (pr) pr.classList.remove("has-file");
        if (pre) pre.textContent = "";
        if (title) title.textContent = "";
      });
      var filterInp = document.getElementById("dev-cache-files-filter");
      if (filterInp && !filterInp.getAttribute("data-dev-filter-wired")) {
        filterInp.setAttribute("data-dev-filter-wired", "1");
        filterInp.addEventListener("input", onFilterInput);
        filterInp.addEventListener("change", onFilterInput);
      }
      document.addEventListener("click", function (ev) {
        var modal = document.getElementById("dev-cache-files-modal");
        if (!modal) return;
        var dsp = modal.style.display;
        if (dsp === "none" || dsp === "") return;
        var el = ev.target;
        var btn = null;
        if (el && el.closest) {
          btn = el.closest("button.dev-cache-view-btn");
        } else {
          var n = el;
          while (n && n.nodeName !== "BUTTON") n = n.parentElement;
          if (n && n.className && (" " + n.className + " ").includes(" dev-cache-view-btn ")) btn = n;
        }
        if (!btn) return;
        var enc = btn.getAttribute("data-path-enc");
        if (!enc) return;
        var pAbs = decodeURIComponent(enc);
        var pre = document.getElementById("dev-cache-preview-body");
        var title = document.getElementById("dev-cache-preview-title");
        var pr = document.getElementById("dev-cache-file-preview");
        if (!pre || !pr) return;
        try {
          ev.preventDefault();
        } catch (error) { /* intentional */ }
        pr.classList.add("has-file");
        pre.textContent = "Lade …";
        if (title) title.textContent = pAbs;
        var rq = new XMLHttpRequest();
        rq.open("POST", "/api/debug/cache-file-view", true);
        rq.setRequestHeader("Content-Type", "application/json");
        rq.onload = function () {
          if (rq.status !== 200) {
            pre.textContent = "HTTP " + rq.status;
            return;
          }
          try {
            var o = JSON.parse(rq.responseText);
            if (!o.ok) {
              pre.textContent = o.error || "error";
              return;
            }
            if (title) title.textContent = (o.path_ui || "") + (o.truncated ? " (gekuerzt)" : "");
            var raw = o.content != null ? String(o.content) : "";
            // JSON documents and line-delimited JSON both use the collapsible
            // tree. A truncated NDJSON preview still contains many complete
            // records and should not fall back to an unreadable text blob.
            var didTree = false;
            var parsedEvidence = parseJsonEvidence(raw);
            if (parsedEvidence) {
              renderJsonEvidence(pre, parsedEvidence, o);
              didTree = true;
            }
            if (!didTree) {
              // Truncated or non-JSON: try to pretty-print what we can
              try {
                // Attempt partial JSON: find last complete top-level entry
                var lastBrace = raw.lastIndexOf('}');
                if (lastBrace > 0 && raw.trimStart()[0] === '{') {
                  // Try to close the JSON structure
                  var attempt = raw.slice(0, lastBrace + 1);
                  // Count open braces/brackets to close
                  var openB = 0, openA = 0;
                  for (var ci = 0; ci < attempt.length; ci++) {
                    if (attempt[ci] === '{') openB++;
                    else if (attempt[ci] === '}') openB--;
                    else if (attempt[ci] === '[') openA++;
                    else if (attempt[ci] === ']') openA--;
                  }
                  var closer = '';
                  while (openA > 0) { closer += ']'; openA--; }
                  while (openB > 0) { closer += '}'; openB--; }
                  var partial = JSON.parse(attempt + closer);
                  pre.innerHTML = "";
                  pre.appendChild(buildJsonTree(partial, 0, true));
                  if (o.truncated) {
                    var trNote = document.createElement('div');
                    trNote.className = 'jt-more';
                    trNote.textContent = '… truncated (' + (o.size / 1024 / 1024).toFixed(1) + ' MB total, showing partial)';
                    pre.appendChild(trNote);
                  }
                  didTree = true;
                }
              } catch (error) { /* intentional */ }
              if (!didTree) pre.textContent = raw;
            }
          } catch (eZ) {
            pre.textContent = "parse error: " + String(eZ?.message ? eZ.message : eZ);
          }
        };
        rq.onerror = function () {
          pre.textContent = "network error";
        };
        rq.send(JSON.stringify({ path_abs: pAbs }));
      });
      document.addEventListener("keydown", function (evK) {
        if (!sharedCacheModalEl || sharedCacheModalEl.style.display === "none") return;
        if (evK.keyCode === 27) closeModal();
      });
      return sharedCacheModalEl;
    }
    function closeModal() {
      if (!sharedCacheModalEl) return;
      resetCacheDialogLayout();
      var acc = document.getElementById("dev-cache-files-accordion");
      if (acc) acc.innerHTML = "";
      var fin = document.getElementById("dev-cache-files-filter");
      if (fin) fin.value = "";
      sharedCacheModalEl.style.display = "none";
      sharedCacheModalEl.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      setLoadStatus("");
      var pr2 = document.getElementById("dev-cache-file-preview");
      var pre2 = document.getElementById("dev-cache-preview-body");
      var ti2 = document.getElementById("dev-cache-preview-title");
      if (pr2) pr2.classList.remove("has-file");
      if (pre2) pre2.textContent = "";
      if (ti2) ti2.textContent = "";
    }
    function openModal() {
      ensureModal();
      resetCacheDialogLayout();
      sharedCacheModalEl.style.display = "flex";
      sharedCacheModalEl.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      var acc = document.getElementById("dev-cache-files-accordion");
      if (acc) acc.innerHTML = "";
      var fin = document.getElementById("dev-cache-files-filter");
      if (fin) fin.value = "";
      setLoadStatus("Lade …");
      var pr = document.getElementById("dev-cache-file-preview");
      var pre0 = document.getElementById("dev-cache-preview-body");
      var ti0 = document.getElementById("dev-cache-preview-title");
      if (pr) pr.classList.remove("has-file");
      if (pre0) pre0.textContent = "";
      if (ti0) ti0.textContent = "";
      var xhr = new XMLHttpRequest();
      xhr.open("GET", "/api/debug/cache-files", true);
      xhr.onload = function () {
        if (xhr.status !== 200) {
          setLoadStatus("Fehler " + xhr.status);
          return;
        }
        var data;
        try {
          data = JSON.parse(xhr.responseText);
        } catch (eP) {
          setLoadStatus("JSON Fehler");
          return;
        }
        if (!data.ok || !data.files) {
          setLoadStatus("Keine Daten");
          return;
        }
        var files = data.files;
        var folderSet = Object.create(null);
        for (var gi = 0; gi < files.length; gi++) {
          var fk = files[gi].folder_ui || "(?)";
          folderSet[fk] = true;
        }
        var folderCount = Object.keys(folderSet).length;
        setLoadStatus(String(files.length) + " Dateien in " + folderCount + " Ordnern");
        buildFolderTree(files);
        onFilterInput();
      };
      xhr.onerror = function () {
        setLoadStatus("Netzwerkfehler");
      };
      xhr.send();
    }
    openBtn.addEventListener("click", openModal);
  }

  global.CacheFilesExplorer = {
    wireOpenButton: wireOpenButton
  };
})(typeof window !== "undefined" ? window : this);
