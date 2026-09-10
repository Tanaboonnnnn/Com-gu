# Linux Desktop release-candidate checks

These checks are intentionally manual. Unit/CI coverage proves the adapter contracts, but it
cannot prove a real compositor, portal backend, permission dialog, D-Bus session, or monitor
topology. Do not claim Wayland release-candidate coverage until these have been run on the
target desktop session.

## Ubuntu GNOME Wayland

- Confirm `echo "$XDG_SESSION_TYPE"` is `wayland` and `gdbus` is installed.
- Start ComGu from the same logged-in user session; do not use a system service or Session 0-like
  context.
- Enable only Screen first. Connect Desktop and confirm the portal consent dialog is visible.
- Accept screen sharing, take two screenshots, and verify their frame IDs advance.
- Resize the returned image and click a known harmless target using image coordinates; verify the
  physical pointer lands on the same logical target.
- Enable input, reconnect, grant pointer/keyboard, and verify move/click/type through the portal.
- Deny pointer or keyboard once and verify the corresponding capability is absent rather than
  failing Core or pretending the action succeeded.
- Revoke/close the portal session while ComGu is running and verify Desktop becomes unavailable
  immediately while Core remains usable.
- Log out and back in; verify the old portal session is not reused as though still authorized.
- Clipboard must remain unavailable on the current gdbus transport; do not advertise it until a
  Unix-FD-safe Clipboard portal implementation exists.

## Ubuntu GNOME X11

- Confirm `echo "$XDG_SESSION_TYPE"` is `x11` and `xdotool` plus ImageMagick `import` exist.
- Verify whole-screen capture and scaled-image pointer coordinates on a non-destructive target.
- Verify a stale screenshot frame is rejected with `STALE_FRAME`.
- Verify semantic UI refs fail explicitly instead of falling back to coordinates.
- With `xclip` installed, verify clipboard read/write; without it, verify clipboard capabilities
  are absent while screen/input continue to work.

Record distro, desktop version, portal/backend versions, architecture, and each pass/fail result
in the release handoff before publishing Linux Desktop support.
