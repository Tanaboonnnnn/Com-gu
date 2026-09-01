import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { EN, TH, normalizeLocale, t } from '../src/shared/i18n/index.js';

describe('i18n', () => {
  it('accepts only supported persisted locales', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('th')).toBe('th');
    expect(normalizeLocale('TH')).toBe('en');
    expect(normalizeLocale('')).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
  });

  it('keeps the Thai catalogue key-for-key with English', () => {
    expect(Object.keys(TH).sort()).toEqual(Object.keys(EN).sort());
  });

  it('keeps the secure-storage recovery message as natural Thai copy', () => {
    expect(TH['setup.secureStorageUnreadable']).toBe('ปลดล็อกข้อมูลรับรองที่บันทึกไว้ไม่ได้ ไฟล์ที่เข้ารหัสเดิมจึงถูกเก็บไว้โดยไม่แก้ไข');
  });

  it('interpolates named values without evaluating HTML', () => {
    expect(t('en', 'common.count', { count: 3 })).toBe('3 items');
    expect(t('th', 'common.count', { count: 3 })).toBe('3 รายการ');
    expect(t('th', 'common.named', { name: '<b>Core</b>' })).toBe('<b>Core</b>');
  });

  it('leaves unknown placeholders visible', () => {
    expect(t('en', 'common.named', {})).toBe('{name}');
  });

  it('falls back to English when a Thai runtime entry is unavailable', () => {
    const thai = TH as Record<string, string | undefined>;
    const original = thai['common.connect'];
    delete thai['common.connect'];
    try {
      expect(t('th', 'common.connect')).toBe('Connect');
    } finally {
      thai['common.connect'] = original;
    }
  });

  it('returns the selected locale copy', () => {
    expect(t('th', 'common.connect')).toBe('เชื่อมต่อ');
    expect(t('en', 'common.connect')).toBe('Connect');
  });

  it('keeps security-sensitive command wording explicit in Thai', () => {
    expect(TH['permissions.command.detail']).toContain('ไม่ได้จำกัดอยู่แค่โฟลเดอร์ที่อนุญาต');
  });

  it('keeps protocol and product literals intact in Thai UI copy', () => {
    const thai = Object.values(TH).join('\n');
    expect(thai).toContain('ChatGPT');
    expect(thai).toContain('API key');
    expect(thai).toContain('Developer mode');
  });

  it('covers deterministic Home, Setup, Chat and Activity copy in natural Thai', () => {
    expect(TH['home.permissions']).toBe('สิทธิ์การเข้าถึง');
    expect(TH['home.folders']).toBe('โฟลเดอร์');
    expect(TH['setup.pickFolder']).toBe('เลือกโฟลเดอร์ที่จะแชร์');
    expect(TH['setup.addInChatgpt']).toBe('เพิ่มใน ChatGPT');
    expect(TH['chat.sessions']).toBe('เซสชัน');
    expect(TH['chat.timeline']).toBe('ไทม์ไลน์');
    expect(TH['activity.title']).toBe('กิจกรรม');
    expect(TH['activity.turnStarted']).toBe('เริ่มเทิร์นแล้ว');
    expect(TH['permissions.cap.command.label']).toBe('รันคำสั่ง');
    expect(TH['permissions.cap.command.detail']).toContain('ไม่จำกัดอยู่แค่โฟลเดอร์ที่อนุญาต');
    expect(TH['goal.modelsShown']).toContain('แสดง');
    expect(TH['agents.workerWorking']).toBe('{count} กำลังทำงาน');
    expect(TH['tray.open']).toBe('เปิด ComGu');
    expect(TH['tray.quit']).toBe('ออกจาก ComGu');
  });

  it('does not leave deterministic English leaf copy outside the i18n surface', () => {
    const html = readFileSync(path.join(process.cwd(), 'src', 'renderer', 'index.html'), 'utf8');
    const document = new JSDOM(html).window.document;
    // These nodes are deliberately repainted from live state after startup. Giving them a
    // static data-i18n attribute would overwrite the live value on every state refresh.
    const dynamic = new Set([
      'versionBtn',
      'wizFolders',
      'backgroundRunningCopy',
      'minimizeToTrayCopy',
      'chatTitle',
      'updateTitle'
    ]);
    const untranslated: string[] = [];
    for (const node of document.querySelectorAll<HTMLElement>('body *')) {
      if (node.children.length > 0 || node.closest('script, style, svg, code, pre')) continue;
      const text = (node.textContent ?? '').trim().replace(/\s+/g, ' ');
      if (!text || !/[A-Za-z]/.test(text)) continue;
      if (node.tagName === 'OPTION' && (node as HTMLOptionElement).value === 'en') continue;
      if (dynamic.has(node.id)) continue;
      if (
        node.hasAttribute('data-i18n') ||
        node.hasAttribute('data-i18n-title') ||
        node.hasAttribute('data-i18n-placeholder')
      ) continue;
      untranslated.push(`${node.tagName.toLowerCase()}#${node.id}: ${text}`);
    }
    expect(untranslated).toEqual([]);
  });
});
