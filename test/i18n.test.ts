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
  });
});
