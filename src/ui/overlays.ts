import type { DataError } from '../data/load';
import { buildErrorReport, type ReportEnv } from '../app/report';
import { button, el } from './dom';

/** Environment details for crash reports. */
export function reportEnv(): ReportEnv {
  return {
    version: __APP_VERSION__,
    userAgent: navigator.userAgent,
    screen: `${screen.width}x${screen.height}`,
  };
}

/** Replace whatever fatal screen is showing; fatal screens live on <body>, outside the game UI. */
function mountFatal(node: HTMLElement): void {
  document.querySelector('.sw-fatal')?.remove();
  document.body.append(node);
}

/** Copy via the clipboard API; falls back to selecting the text so the player can copy by hand. */
async function copyText(text: string, area: HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    area.focus();
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

/** Full-screen "Something went wrong" with the report and Copy / Reload. Text only, never HTML. */
export function showCrash(err: unknown): void {
  let report: string;
  try {
    report = buildErrorReport(err, reportEnv());
  } catch {
    report = `Message: ${String(err)}`;
  }
  const area = el('textarea', {
    class: 'sw-fatal-report',
    attrs: { readonly: '', rows: '10', 'aria-label': 'Error report', 'data-testid': 'crash-report' },
  });
  area.value = report;
  const status = el('p', { class: 'sw-fatal-status', attrs: { 'aria-live': 'polite' } });
  const copy = button('Copy error report', () => {
    void copyText(report, area).then((ok) => {
      status.textContent = ok ? 'Copied.' : 'Select the text above and copy it by hand.';
    });
  });
  const reload = button('Reload', () => location.reload(), { class: 'sw-btn-primary' });
  mountFatal(
    el('div', { class: 'sw-fatal', attrs: { role: 'alert', 'data-testid': 'crash-screen' } }, [
      el('div', { class: 'sw-panel sw-fatal-panel' }, [
        el('h1', { class: 'sw-title', text: 'Something went wrong' }),
        el('p', { text: 'Starwake hit an unexpected error. Your last landing was saved.' }),
        area,
        el('div', { class: 'sw-actions-row' }, [copy, reload]),
        status,
      ]),
    ]),
  );
}

/** Full-screen list of every problem found in the game data files. */
export function showDataError(e: DataError): void {
  const list = el('ul', { class: 'sw-fatal-issues', attrs: { 'data-testid': 'data-error' } });
  for (const issue of e.issues) list.append(el('li', { text: issue }));
  mountFatal(
    el('div', { class: 'sw-fatal', attrs: { role: 'alert' } }, [
      el('div', { class: 'sw-panel sw-fatal-panel' }, [
        el('h1', { class: 'sw-title', text: 'Game data is invalid' }),
        el('p', { text: `${e.file} could not be loaded:` }),
        list,
        el('div', { class: 'sw-actions-row' }, [button('Reload', () => location.reload(), { class: 'sw-btn-primary' })]),
      ]),
    ]),
  );
}

/** Small non-blocking banner: "Update available. Restart?" `onDismiss` runs on Restart or Later. */
export function showUpdatePrompt(onRestart: () => void, onDismiss: () => void = () => {}): void {
  if (document.querySelector('.sw-update')) return;
  const bar = el('div', { class: 'sw-panel sw-update', attrs: { role: 'status', 'data-testid': 'update-prompt' } });
  bar.append(
    el('span', { text: 'Update available. Restart?' }),
    button(
      'Restart',
      () => {
        bar.remove();
        onDismiss();
        onRestart();
      },
      { class: 'sw-btn-primary' },
    ),
    button('Later', () => {
      bar.remove();
      onDismiss();
    }),
  );
  document.body.append(bar);
}

/** Remove the update banner if it is open (flight started). */
export function hideUpdatePrompt(): void {
  document.querySelector('.sw-update')?.remove();
}
