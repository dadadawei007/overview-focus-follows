# Overview Focus Follows Workspace

A small GNOME Shell 50 extension that makes keyboard focus and virtual
workspaces follow each other in the Activities overview.

GNOME's window picker lets directional navigation move focus to a window on
another workspace without activating that workspace. When the destination
workspace is empty, there is no window preview to receive focus, so navigation
can appear to stop or lose its target.

This extension keeps directional focus navigation inside the current workspace,
activates the neighboring workspace only when focus crosses its edge, and
provides a focusable target for empty workspaces.

## Behavior

- `Up`, `Down`, `Left`, and `Right` move focus between window previews inside
  the current workspace.
- Focus does not leave the top or bottom edge of a workspace.
- Continuing past the left or right edge activates the neighboring workspace
  and moves focus to its nearest window.
- An empty workspace receives focus as a whole and is highlighted with a blue
  outline.
- `Enter` on an empty workspace leaves the overview and enters that workspace.
- Arrow keys continue to work normally while typing in the overview search box.

## Compatibility

The extension currently targets GNOME Shell 50 and was developed on Ubuntu
26.04 with Wayland.

It uses private GNOME Shell 50 APIs, so later GNOME releases may require code
changes.

## Install

Clone the repository and run:

```sh
make install
```

Alternatively, build and install the archive manually:

```sh
make package
gnome-extensions install --force \
  dist/overview-focus-follows@dadadawei.local.shell-extension.zip
gnome-extensions enable overview-focus-follows@dadadawei.local
```

After installing for the first time under Wayland, log out and back in once so
GNOME Shell loads the new extension.

## Development

The extension has no build step. Edit `extension.js` or `stylesheet.css`, then
reinstall it:

```sh
make install
```

GNOME Shell caches JavaScript modules. If changes do not appear after
disabling and enabling the extension, start a new desktop session.

## Uninstall

```sh
make uninstall
```

## License

MIT. See [LICENSE](LICENSE).
