import { describe, expect, it, vi } from 'vitest';
import {
  createPortalWaylandSession,
  parseGdbusRequestPath,
  parsePortalResponse,
  type PortalTransport
} from '../src/main/desktop/linux/wayland-portal.js';

describe('Wayland portal transport parsing', () => {
  it('extracts the request object path from gdbus call output', () => {
    expect(
      parseGdbusRequestPath("(objectpath '/org/freedesktop/portal/desktop/request/1_42/comgu_abc',)")
    ).toBe('/org/freedesktop/portal/desktop/request/1_42/comgu_abc');
  });

  it('parses the bounded response facts used by ComGu without evaluating GVariant text', () => {
    const parsed = parsePortalResponse(
      "/org/freedesktop/portal/desktop/request/1_42/comgu: org.freedesktop.portal.Request.Response (uint32 0, {'session_handle': <'/org/freedesktop/portal/desktop/session/1_42/comgu_session'>, 'devices': <uint32 3>, 'clipboard_enabled': <false>, 'streams': <[(uint32 77, {'size': <(1920, 1080)>})]>})"
    );
    expect(parsed).toEqual({
      code: 0,
      sessionHandle: '/org/freedesktop/portal/desktop/session/1_42/comgu_session',
      devices: 3,
      clipboardEnabled: false,
      stream: { id: 77, width: 1920, height: 1080 },
      uri: null
    });
  });
});

describe('Wayland portal session negotiation', () => {
  it('does not advertise capture from the independent Screenshot portal as RemoteDesktop-stream pixels', async () => {
    const closedHandlers: Array<() => void> = [];
    const request = vi
      .fn<PortalTransport['request']>()
      .mockResolvedValueOnce({ code: 0, sessionHandle: '/session/comgu', devices: null, clipboardEnabled: null, stream: null, uri: null })
      .mockResolvedValueOnce({ code: 0, sessionHandle: null, devices: null, clipboardEnabled: null, stream: null, uri: null })
      .mockResolvedValueOnce({ code: 0, sessionHandle: null, devices: null, clipboardEnabled: null, stream: null, uri: null })
      .mockResolvedValueOnce({ code: 0, sessionHandle: null, devices: 2, clipboardEnabled: false, stream: { id: 77, width: 1920, height: 1080 }, uri: null });
    const transport: PortalTransport = {
      request,
      call: vi.fn(async () => ''),
      onSessionClosed: vi.fn((_path, handler) => {
        closedHandlers.push(handler);
        return () => {
          const index = closedHandlers.indexOf(handler);
          if (index >= 0) closedHandlers.splice(index, 1);
        };
      }),
      close: vi.fn(async () => undefined)
    };

    const session = await createPortalWaylandSession({ transport, screenshotSupported: true });
    expect(session.grants()).toEqual({
      active: true,
      capture: false,
      pointer: true,
      keyboard: false,
      clipboardRead: false,
      clipboardWrite: false,
      width: 1920,
      height: 1080
    });
    await expect(session.screenshot()).rejects.toThrow(/same.*stream|capture.*unavailable/i);

    closedHandlers[0]?.();
    expect(session.grants().active).toBe(false);
    await session.close();
    expect(transport.close).toHaveBeenCalled();
  });

  it('advertises capture only when bytes come from the selected ScreenCast stream', async () => {
    const request = vi
      .fn<PortalTransport['request']>()
      .mockResolvedValueOnce({ code: 0, sessionHandle: '/session/comgu', devices: null, clipboardEnabled: null, stream: null, uri: null })
      .mockResolvedValueOnce({ code: 0, sessionHandle: null, devices: null, clipboardEnabled: null, stream: null, uri: null })
      .mockResolvedValueOnce({ code: 0, sessionHandle: null, devices: null, clipboardEnabled: null, stream: null, uri: null })
      .mockResolvedValueOnce({ code: 0, sessionHandle: null, devices: 2, clipboardEnabled: false, stream: { id: 77, width: 1920, height: 1080 }, uri: null });
    const captureSelectedStream = vi.fn(async (_id: number, _width: number, _height: number) => Buffer.from('frame'));
    const transport: PortalTransport = {
      request,
      call: vi.fn(async () => ''),
      onSessionClosed: () => () => {},
      close: vi.fn(async () => undefined)
    };

    const session = await createPortalWaylandSession({ transport, captureSelectedStream });
    expect(session.grants().capture).toBe(true);
    expect(await session.screenshot()).toEqual(Buffer.from('frame'));
    expect(captureSelectedStream).toHaveBeenCalledWith(77, 1920, 1080);
  });

  it('uses only portal Notify methods for input and never shells out to synthetic Wayland input', async () => {
    const request = vi
      .fn<PortalTransport['request']>()
      .mockResolvedValueOnce({ code: 0, sessionHandle: '/session/comgu', devices: null, clipboardEnabled: null, stream: null, uri: null })
      .mockResolvedValueOnce({ code: 0, sessionHandle: null, devices: null, clipboardEnabled: null, stream: null, uri: null })
      .mockResolvedValueOnce({ code: 0, sessionHandle: null, devices: null, clipboardEnabled: null, stream: null, uri: null })
      .mockResolvedValueOnce({ code: 0, sessionHandle: null, devices: 3, clipboardEnabled: false, stream: { id: 42, width: 1280, height: 720 }, uri: null });
    const call = vi.fn<PortalTransport['call']>();
    call.mockResolvedValue('');
    const transport: PortalTransport = {
      request,
      call,
      onSessionClosed: () => () => {},
      close: vi.fn(async () => undefined)
    };
    const session = await createPortalWaylandSession({ transport, screenshotSupported: false });

    await session.move(10, 20);
    await session.button('left', true);
    await session.scroll(0, 12);
    await session.keysym(0x41, true);

    expect(call.mock.calls.map(([method]) => method)).toEqual([
      'org.freedesktop.portal.RemoteDesktop.NotifyPointerMotionAbsolute',
      'org.freedesktop.portal.RemoteDesktop.NotifyPointerButton',
      'org.freedesktop.portal.RemoteDesktop.NotifyPointerAxis',
      'org.freedesktop.portal.RemoteDesktop.NotifyKeyboardKeysym'
    ]);
    expect(call.mock.calls.flat().join(' ')).not.toMatch(/ydotool|wtype|xdotool/);
  });
});
