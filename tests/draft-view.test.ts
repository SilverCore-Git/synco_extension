import { describe, expect, test } from 'bun:test';
import type { TaskDraft } from '../src/page-actions/contract';
import { renderDraftCard } from '../src/ui/popup/draftView';
import { asEl, buttonByText, fakeDoc } from './helpers/fakeDom';

const draft = (over: Partial<TaskDraft> = {}): TaskDraft => ({
  v: 1, text: 'Appeler le client', url: 'https://exemple.fr/devis', title: 'Devis', capturedAt: Date.UTC(2026, 9, 19, 10, 5), ...over,
});

describe('carte « brouillon de tâche en attente »', () => {
  test('affiche texte, page, URL, date, et dit honnêtement que rien n\'est encore envoyé', () => {
    const t = asEl(renderDraftCard(fakeDoc(), draft(), { dismiss() {} })).textContent;
    expect(t).toContain('Brouillon de tâche en attente');
    expect(t).toContain('« Appeler le client »');
    expect(t).toContain('Page : Devis');
    expect(t).toContain('https://exemple.fr/devis');
    expect(t).toContain('19 octobre 2026');
    expect(t).toContain('pas encore transmis à Synco');
  });

  test('« Ignorer » relié au gestionnaire', () => {
    let n = 0;
    const root = asEl(renderDraftCard(fakeDoc(), draft(), { dismiss: () => { n++; } }));
    buttonByText(root, 'Ignorer le brouillon').click();
    expect(n).toBe(1);
  });

  test('titre et URL absents : lignes omises', () => {
    const t = asEl(renderDraftCard(fakeDoc(), draft({ title: '', url: '' }), { dismiss() {} })).textContent;
    expect(t).not.toContain('Page :');
    expect(t).not.toContain('https://');
  });

  test('extrait plafonné pour un long texte', () => {
    const t = asEl(renderDraftCard(fakeDoc(), draft({ text: 'a'.repeat(1000) }), { dismiss() {} })).textContent;
    expect(t).toContain('a'.repeat(240) + '…');
    expect(t).not.toContain('a'.repeat(241));
  });

  test('contenu de page hostile : inséré en texte, jamais en HTML', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const root = asEl(renderDraftCard(fakeDoc(), draft({ text: hostile, title: hostile }), { dismiss() {} }));
    expect(root.textContent).toContain(hostile);
    expect(root.findAll((e) => ['img', 'script', 'iframe', 'a'].includes(e.tagName))).toEqual([]);
  });
});
