# Linux Desktop release-candidate checks

These checks are intentionally manual. Unit/CI coverage proves the adapter contracts, but it
cannot prove a real compositor, portal backend, permission dialog, D-Bus session, or monitor
topology. Do not claim Wayland release-candidate coverage until these have been run on the
target desktop session.

## Ubuntu GNOME Wayland

- Confirm `echo "$XDG_SESSION_TYPE"` is `wayland` and `gdbus` is installed.
- Start ComGu from the same logged-in user session; do not use a system service or Session 0-like
  context.
- Connect Desktop and confirm the RemoteDesktop/ScreenCast portal consent dialog is visible.
- With the current gdbus transport, verify `screen`/capture stays unavailable: ComGu must not use
  `org.freedesktop.portal.Screenshot` as a substitute for the selected ScreenCast stream.
- Grant keyboard and verify keypress/type through the portal, including cleanup after an injected
  or naturally occurring partial key failure.
- Pointer permission may be granted by the portal, but frame-coordinate click/move must remain
  unavailable until capture bytes are proven to come from that exact selected ScreenCast stream.
- Deny pointer or keyboard once and verify the corresponding capability is absent rather than
  failing Core or pretending the action succeeded.
- Revoke/close the portal session while ComGu is running and verify Desktop becomes unavailable
  immediately while Core remains usable.
- Log out and back in; verify the old portal session is not reused as though still authorized.
- Clipboard must remain unavailable on the current gdbus transport; do not advertise it until a
  Unix-FD-safe Clipboard portal implementation exists.

### Wayland same-stream capture promotion gate

Do not promote Wayland frame-based pointer control when a future PipeWire adapter is added until a
real graphical-session RC proves all of the following on the final SHA:

- Use at least two monitors and select one portal source that is not the whole logical desktop.
- Record the selected ScreenCast stream id/geometry without recording sensitive screen contents.
- Capture from that exact selected stream, resize the returned frame, and click a harmless visual
  target using its returned frame coordinates.
- Verify the physical pointer lands on exactly that visual target on the selected monitor.
- Repeat after portal revocation/regrant and after changing the selected monitor.
- Confirm no independent Screenshot-portal image is accepted as coordinate authority merely because
  its dimensions happen to match the selected stream.

## Ubuntu GNOME X11

- Confirm `echo "$XDG_SESSION_TYPE"` is `x11` and `xdotool` plus ImageMagick `import` exist.
- Verify whole-screen capture and scaled-image pointer coordinates on a non-destructive target.
- Verify a stale screenshot frame is rejected with `STALE_FRAME`.
- Verify semantic UI refs fail explicitly instead of falling back to coordinates.
- With `xclip` installed, verify clipboard read/write; without it, verify clipboard capabilities
  are absent while screen/input continue to work.

Record distro, desktop version, portal/backend versions, architecture, and each pass/fail result
in the release handoff before publishing Linux Desktop support.
