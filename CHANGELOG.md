# Changelog

## 11

- When opening the overview without a direction, focus the preview of the
  last focused window instead of the first window in the layout.

## 10

- Replace the hand-tuned neighbor heuristic with the spatial navigation
  distance function used by W3C CSS Spatial Navigation and Chromium Blink:
  `euclidean + navigation axis distance + weighted orthogonal distance
  - sqrt(overlap)`, measured on full window bounding boxes.
- Keep a strong same-row preference for left/right and a same-column
  preference for up/down through orthogonal distance weights.

## 9

- Stop falling back to a boundary window when the current focused preview is
  not recognized, which could make vertical and horizontal keys feel swapped.
- Track preview destruction so cleanup no longer touches disposed actors.

## 8

- Choose the next focused window from GNOME's real layout slots.
- Prefer windows aligned on the same horizontal or vertical axis before
  falling back to the nearest window in that direction.

## 6

- Use a dedicated focusable layer for empty workspaces so `Enter` enters the
  empty workspace instead of reactivating the previous window.
- Avoid accessing destroyed child actors and apply window focus styles safely.
- Render a solid border on focused window previews.

## 5

- Resolve focused window previews through their parent actors so the focus
  outline works when a window preview contains child widgets.
- Restore proper vertical navigation instead of falling back to a default
  preview whenever the focused actor was not recognized.

## 4

- Apply focus styling directly to GNOME Shell window preview actors because
  GNOME 50 does not expose a usable `:focus` theme selector.
- Strengthen the visual focus indicator for windows and empty workspaces.

## 3

- Prevent rapid horizontal key presses from bouncing back after a workspace
  change.
- Focus the correct edge window immediately when entering a workspace.
- Add a blue outline and glow to the focused window preview.

## 2

- Keep directional focus navigation inside the current workspace.
- Follow focus into neighboring workspaces when crossing the left or right edge.
- Stop navigation at the top and bottom edges instead of losing focus.
- Add focus feedback and an `Enter` action for empty workspaces.

## 1

- Initial implementation for GNOME Shell 50.
