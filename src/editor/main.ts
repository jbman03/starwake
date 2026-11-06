import '../ui/styles.css';
import './editor.css';
import { loadRawGameData, type RawGameData } from '../data/load';
import { LIST_KEYS, readPlugin, type ListKey, type Plugin } from '../plugins/format';
import { PluginStore } from '../plugins/store';
import { button, el } from '../ui/dom';
import { baseRecords, copyOf, loadDraft, newDraft, problems, recordsOf, removeRecord, saveDraft, TYPE_LABEL, upsert, type Rec } from './model';

/**
 * The Starwake Editor (editor spec §5): the plug-in's details, its record types, the records of the chosen type,
 * and the selected record as JSON with live checks. Export downloads the file, Import opens one, Install puts it
 * in the game's Plug-ins (turned on). The draft is kept in this browser.
 */
async function start(root: HTMLElement): Promise<void> {
  const raw: RawGameData = await loadRawGameData();
  const storage = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  let draft: Plugin = loadDraft(storage);
  let type: ListKey = 'ships';
  let selected: string | null = recordsOf(draft, type)[0]?.id ?? null;

  const status = el('p', { class: 'sw-status', attrs: { 'aria-live': 'polite', 'data-testid': 'editor-status' } });
  const say = (text: string, bad = false) => {
    status.textContent = text;
    status.classList.toggle('sw-status-bad', bad);
  };
  const issuesBox = el('ul', { class: 'sw-ed-issues', attrs: { 'data-testid': 'editor-issues' } });
  const types = el('nav', { class: 'sw-ed-types', attrs: { 'aria-label': 'Record types' } });
  const records = el('div', { class: 'sw-ed-records', attrs: { 'data-testid': 'editor-records' } });
  const json = el('textarea', { class: 'sw-ed-json', attrs: { spellcheck: 'false', 'aria-label': 'Record JSON', 'data-testid': 'editor-json' } });
  const jsonError = el('p', { class: 'sw-reason sw-ex-bad', attrs: { 'data-testid': 'editor-json-error' } });
  const copyFrom = el('select', { class: 'sw-ed-select', attrs: { 'aria-label': 'Copy a record', 'data-testid': 'editor-copy-from' } });

  const field = (label: string, key: 'id' | 'name' | 'version' | 'author' | 'description') => {
    const input = el(key === 'description' ? 'textarea' : 'input', { class: 'sw-ed-input', attrs: { 'aria-label': label, 'data-testid': `editor-${key}` } }) as HTMLInputElement;
    input.value = String(draft[key] ?? '');
    input.addEventListener('input', () => {
      draft = { ...draft, [key]: input.value };
      changed();
    });
    return el('label', { class: 'sw-ed-field' }, [el('span', { text: label }), input]);
  };
  const makeDetails = () =>
    el('section', { class: 'sw-ed-details' }, [field('Id', 'id'), field('Name', 'name'), field('Version', 'version'), field('Author', 'author'), field('Description', 'description')]);
  let details = makeDetails();
  /** The details fields show a newly opened (or new) draft. */
  const resetDetails = () => {
    const next = makeDetails();
    details.replaceWith(next);
    details = next;
  };

  /** Re-check the whole draft and keep it in the browser. */
  function changed(): void {
    saveDraft(storage, draft);
    const list = problems(raw, draft);
    issuesBox.replaceChildren(
      ...(list.length
        ? list.slice(0, 12).map((t) => el('li', { text: t }))
        : [el('li', { class: 'sw-ed-ok', text: 'No problems: this plug-in would load.' })]),
    );
    renderTypes();
    renderRecords();
  }

  function renderTypes(): void {
    types.replaceChildren(
      ...LIST_KEYS.map((k) => {
        const n = recordsOf(draft, k).length;
        const b = button(`${TYPE_LABEL[k]}${n ? ` (${n})` : ''}`, () => {
          type = k;
          selected = recordsOf(draft, k)[0]?.id ?? null;
          renderAll();
        }, { class: k === type ? 'sw-tab sw-tab-active' : 'sw-tab' });
        b.dataset.type = k;
        return b;
      }),
    );
  }

  function renderRecords(): void {
    const recs = recordsOf(draft, type);
    records.replaceChildren(
      ...(recs.length
        ? recs.map((r) => {
            const b = button(`${r.id}${typeof r.name === 'string' ? ` — ${r.name}` : typeof r.title === 'string' ? ` — ${r.title}` : ''}`, () => {
              selected = r.id;
              renderRecords();
              renderJson();
            }, { class: r.id === selected ? 'sw-ed-rec sw-ed-rec-on' : 'sw-ed-rec' });
            b.dataset.record = r.id;
            return b;
          })
        : [el('p', { class: 'sw-empty', text: `No ${TYPE_LABEL[type].toLowerCase()} yet. Copy one from the game below and change it.` })]),
    );
    copyFrom.replaceChildren(
      el('option', { text: `Copy a ${TYPE_LABEL[type].toLowerCase().replace(/s$/, '')} from the game…`, attrs: { value: '' } }),
      ...baseRecords(raw, type).map((r) => el('option', { text: `${r.id}${typeof r.name === 'string' ? ` (${r.name})` : ''}`, attrs: { value: r.id } })),
    );
  }

  function renderJson(): void {
    const rec = recordsOf(draft, type).find((r) => r.id === selected);
    json.value = rec ? JSON.stringify(rec, null, 2) : '';
    json.disabled = !rec;
    jsonError.textContent = '';
  }

  function renderAll(): void {
    renderTypes();
    renderRecords();
    renderJson();
  }

  json.addEventListener('input', () => {
    let rec: Rec;
    try {
      rec = JSON.parse(json.value) as Rec;
    } catch (e) {
      jsonError.textContent = `Not valid JSON yet: ${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    if (typeof rec !== 'object' || rec === null || Array.isArray(rec) || typeof rec.id !== 'string' || !rec.id) {
      jsonError.textContent = 'A record is an object with an "id".';
      return;
    }
    jsonError.textContent = '';
    draft = upsert(draft, type, rec, selected ?? rec.id);
    selected = rec.id;
    changed();
  });

  copyFrom.addEventListener('change', () => {
    const id = (copyFrom as HTMLSelectElement).value;
    if (!id) return;
    const rec = copyOf(raw, draft, type, id);
    if (!rec) return;
    draft = upsert(draft, type, rec);
    selected = rec.id;
    changed();
    renderJson();
    say(`Copied ${id} as ${rec.id}. Change its id, name and numbers in the JSON.`);
  });

  const del = button('Delete record', () => {
    if (!selected) return;
    draft = removeRecord(draft, type, selected);
    selected = recordsOf(draft, type)[0]?.id ?? null;
    changed();
    renderJson();
  }, { class: 'sw-btn-danger' });

  const file = el('input', { class: 'sw-hidden', attrs: { type: 'file', accept: '.json,application/json', 'aria-label': 'Plug-in file', 'data-testid': 'editor-file' } });
  file.addEventListener('change', () => {
    const f = (file as HTMLInputElement).files?.[0];
    (file as HTMLInputElement).value = '';
    if (!f) return;
    void f.text().then((text) => {
      const r = readPlugin(text);
      if (!r.ok) return say(`Not a Starwake plug-in: ${r.issues.slice(0, 3).join('; ')}`, true);
      draft = r.plugin;
      type = LIST_KEYS.find((k) => recordsOf(draft, k).length) ?? 'ships';
      selected = recordsOf(draft, type)[0]?.id ?? null;
      resetDetails();
      changed();
      renderJson();
      say(`Opened ${draft.name}.`);
    });
  });

  const exportBtn = button('Export file', () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const a = el('a', { attrs: { href: URL.createObjectURL(blob), download: `${draft.id}.starwake.json` } });
    a.click();
    URL.revokeObjectURL(a.href);
    say(`Saved ${draft.id}.starwake.json. Share it, or import it on the game's Plug-ins screen.`);
  });
  const installBtn = button('Install in the game', () => {
    const list = problems(raw, draft);
    if (list.length) return say(`Fix the problems first: ${list[0]}`, true);
    void new PluginStore().put(draft, true).then(
      () => say(`Installed ${draft.name}. Start (or restart) the game to play with it.`),
      (err: unknown) => say(`Couldn't install it: ${err instanceof Error ? err.message : String(err)}`, true),
    );
  }, { class: 'sw-btn-primary' });
  const fresh = button('New plug-in', () => {
    if (!window.confirm('Start a new plug-in? The current one is lost unless you exported it.')) return;
    draft = newDraft();
    selected = null;
    resetDetails();
    changed();
    renderJson();
  });

  root.replaceChildren(
    el('div', { class: 'sw-ed' }, [
      el('header', { class: 'sw-ed-head' }, [
        el('h1', { class: 'sw-title', text: 'Starwake Editor' }),
        el('a', { class: 'sw-ed-link', text: 'Back to the game', attrs: { href: './' } }),
      ]),
      el('p', { class: 'sw-planet-desc', text: 'Make a plug-in: copy a ship, port or story from the game, change it, and install it or export it to share. Records with a new id are added; one with the id of a game record replaces it.' }),
      details,
      types,
      el('div', { class: 'sw-ed-main' }, [
        el('section', { class: 'sw-ed-list' }, [records, copyFrom, del]),
        el('section', { class: 'sw-ed-edit' }, [json, jsonError, el('h3', { class: 'sw-hotkey-group-title', text: 'Problems' }), issuesBox]),
      ]),
      status,
      el('div', { class: 'sw-actions sw-actions-row' }, [installBtn, exportBtn, button('Import file', () => file.click()), fresh]),
      file,
    ]),
  );
  changed();
  renderJson();
}

void start(document.getElementById('editor')!);
