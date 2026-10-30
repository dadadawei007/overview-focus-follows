import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const FOCUS_DELAY_MS = 180;
const WORKSPACE_SWITCH_COOLDOWN_MS = 180;
const DIRECTION_TOLERANCE = 6;
const ORTHOGONAL_WEIGHT_HORIZONTAL = 30;
const ORTHOGONAL_WEIGHT_VERTICAL = 2;
const PREVIEW_FOCUS_CLASS = 'overview-focus-follows-preview';
const PREVIEW_FOCUS_WINDOW_CLASS = 'overview-focus-follows-preview-window';
const EMPTY_WORKSPACE_FOCUS_CLASS = 'overview-focus-follows-empty';

export default class OverviewFocusFollowsExtension extends Extension {
    enable() {
        this._focusTimeoutId = 0;
        this._emptyWorkspaceActor = null;
        this._focusedPreviewActor = null;
        this._focusedPreviewDestroyId = 0;
        this._pendingDirection = null;
        this._focusGeneration = 0;
        this._switchingWorkspace = false;
        this._switchCooldownUntil = 0;

        this._stageKeyHandlerId = global.stage.connect(
            'captured-event',
            (_actor, event) => this._onCapturedEvent(event));

        this._workspaceChangedHandlerId = global.workspace_manager.connect(
            'active-workspace-changed',
            () => {
                if (this._switchingWorkspace)
                    return;

                if (Main.overview.visible &&
                    !this._isSearchFocused() &&
                    !this._focusIsInActiveWorkspace()) {
                    this._scheduleWorkspaceFocus(
                        FOCUS_DELAY_MS, this._pendingDirection);
                }
            });

        this._overviewShowingHandlerId = Main.overview.connect(
            'showing',
            () => this._scheduleWorkspaceFocus(FOCUS_DELAY_MS * 2));

        this._overviewHiddenHandlerId = Main.overview.connect(
            'hidden',
            () => this._clearWorkspaceFocus());

        this._keyFocusHandlerId = global.stage.connect(
            'notify::key-focus',
            () => this._onKeyFocusChanged());
    }

    disable() {
        if (this._focusTimeoutId) {
            GLib.source_remove(this._focusTimeoutId);
            this._focusTimeoutId = 0;
        }

        if (this._stageKeyHandlerId) {
            global.stage.disconnect(this._stageKeyHandlerId);
            this._stageKeyHandlerId = 0;
        }
        if (this._workspaceChangedHandlerId) {
            global.workspace_manager.disconnect(this._workspaceChangedHandlerId);
            this._workspaceChangedHandlerId = 0;
        }
        if (this._overviewShowingHandlerId) {
            Main.overview.disconnect(this._overviewShowingHandlerId);
            this._overviewShowingHandlerId = 0;
        }
        if (this._overviewHiddenHandlerId) {
            Main.overview.disconnect(this._overviewHiddenHandlerId);
            this._overviewHiddenHandlerId = 0;
        }
        if (this._keyFocusHandlerId) {
            global.stage.disconnect(this._keyFocusHandlerId);
            this._keyFocusHandlerId = 0;
        }

        this._clearWorkspaceFocus();
        this._emptyWorkspaceActor = null;
        this._focusedPreviewActor = null;
        this._focusedPreviewDestroyId = 0;
        this._pendingDirection = null;
        this._focusGeneration++;
    }

    _onCapturedEvent(event) {
        if (event.type() !== Clutter.EventType.KEY_PRESS ||
            !Main.overview.visible ||
            !this._isWindowPicker())
            return Clutter.EVENT_PROPAGATE;

        const symbol = event.get_key_symbol();

        if (symbol === Clutter.KEY_Return ||
            symbol === Clutter.KEY_KP_Enter) {
            if (this._emptyWorkspaceActor === global.stage.key_focus) {
                Main.overview.hide();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        const direction = this._directionForKey(symbol);
        if (!direction)
            return Clutter.EVENT_PROPAGATE;

        const now = GLib.get_monotonic_time() / 1000;
        if ((direction === Meta.MotionDirection.LEFT ||
             direction === Meta.MotionDirection.RIGHT) &&
            now < this._switchCooldownUntil)
            return Clutter.EVENT_STOP;

        this._focusGeneration++;
        this._cancelScheduledFocus();

        if (this._isSearchFocused())
            return Clutter.EVENT_PROPAGATE;

        const activeWorkspace = global.workspace_manager.get_active_workspace();
        const activeWorkspaceActor = this._getWorkspaceActor(activeWorkspace);
        if (!activeWorkspaceActor)
            return Clutter.EVENT_PROPAGATE;

        const keyFocus = global.stage.key_focus;
        const focusedWorkspaceActor = this._findWorkspaceForActor(keyFocus);

        if (!focusedWorkspaceActor) {
            if (keyFocus !== null)
                return Clutter.EVENT_PROPAGATE;

            activeWorkspaceActor.navigate_focus(
                null, direction, false);
            return Clutter.EVENT_STOP;
        }

        if (focusedWorkspaceActor !== activeWorkspaceActor) {
            this._activateWorkspaceActor(focusedWorkspaceActor);
            return Clutter.EVENT_STOP;
        }

        if (this._moveFocusWithinWorkspace(
            focusedWorkspaceActor, keyFocus, direction))
            return Clutter.EVENT_STOP;

        if (direction !== Meta.MotionDirection.LEFT &&
            direction !== Meta.MotionDirection.RIGHT)
            return Clutter.EVENT_STOP;

        const targetWorkspace = activeWorkspace.get_neighbor(direction);
        if (!targetWorkspace ||
            targetWorkspace.index() === activeWorkspace.index())
            return Clutter.EVENT_STOP;

        this._pendingDirection = direction;
        this._switchingWorkspace = true;
        targetWorkspace.activate(global.get_current_time());
        this._focusActiveWorkspace(direction);
        this._switchingWorkspace = false;
        this._switchCooldownUntil =
            GLib.get_monotonic_time() / 1000 +
            WORKSPACE_SWITCH_COOLDOWN_MS;
        this._scheduleWorkspaceFocus(30, direction);
        return Clutter.EVENT_STOP;
    }

    _directionForKey(symbol) {
        switch (symbol) {
        case Clutter.KEY_Left:
            return Meta.MotionDirection.LEFT;
        case Clutter.KEY_Right:
            return Meta.MotionDirection.RIGHT;
        case Clutter.KEY_Up:
            return Meta.MotionDirection.UP;
        case Clutter.KEY_Down:
            return Meta.MotionDirection.DOWN;
        default:
            return null;
        }
    }

    _getControls() {
        return Main.overview?._overview?.controls ?? null;
    }

    _isWindowPicker() {
        const controls = this._getControls();
        if (!controls)
            return false;

        const state = Math.round(controls._stateAdjustment.value);
        return state === OverviewControls.ControlsState.WINDOW_PICKER;
    }

    _isSearchFocused() {
        const searchEntry = Main.overview?._overview?.searchEntry;
        const keyFocus = global.stage.key_focus;
        if (!searchEntry || !keyFocus)
            return false;
        return keyFocus === searchEntry || searchEntry.contains(keyFocus);
    }

    _getPrimaryWorkspaceView() {
        const workspacesDisplay = this._getControls()?._workspacesDisplay;
        if (!workspacesDisplay)
            return null;

        return workspacesDisplay._workspacesViews?.[
            Main.layoutManager.primaryIndex] ?? null;
    }

    _getWorkspaceActor(metaWorkspace) {
        const view = this._getPrimaryWorkspaceView();
        if (!view || !metaWorkspace)
            return null;

        return view._workspaces?.find(
            workspace => workspace.metaWorkspace === metaWorkspace) ?? null;
    }

    _findWorkspaceForActor(actor) {
        const view = this._getPrimaryWorkspaceView();
        if (!view || !actor)
            return null;

        for (let current = actor; current; current = current.get_parent()) {
            const workspaceActor = view._workspaces?.find(
                workspace => workspace === current);
            if (workspaceActor)
                return workspaceActor;
        }
        return null;
    }

    _activateWorkspaceActor(workspaceActor) {
        const metaWorkspace = workspaceActor?.metaWorkspace;
        if (!metaWorkspace || metaWorkspace.active)
            return;

        metaWorkspace.activate(global.get_current_time());
    }

    _onKeyFocusChanged() {
        if (!Main.overview.visible || !this._isWindowPicker())
            return;

        const workspaceActor =
            this._findWorkspaceForActor(global.stage.key_focus);
        if (workspaceActor)
            this._activateWorkspaceActor(workspaceActor);

        const keyFocus = global.stage.key_focus;
        const previewActor =
            this._findPreviewInWorkspace(workspaceActor, keyFocus);
        this._setFocusedPreview(previewActor);

        if (this._emptyWorkspaceActor &&
            keyFocus !== this._emptyWorkspaceActor) {
            this._clearEmptyWorkspaceFocus();
        }
    }

    _setFocusedPreview(previewActor) {
        if (this._focusedPreviewActor === previewActor)
            return;

        this._clearFocusedPreview();
        if (!previewActor)
            return;

        this._focusedPreviewActor = previewActor;
        this._focusedPreviewDestroyId = previewActor.connect(
            'destroy',
            () => this._onFocusedPreviewDestroyed());
        previewActor.add_style_class_name(PREVIEW_FOCUS_CLASS);

        const windowContainer = previewActor.get_first_child?.();
        if (windowContainer?.add_style_class_name) {
            windowContainer.add_style_class_name(PREVIEW_FOCUS_WINDOW_CLASS);
        }
    }

    _findPreviewInWorkspace(workspaceActor, actor) {
        if (!workspaceActor || !actor)
            return null;

        for (let current = actor;
             current && current !== workspaceActor;
             current = current.get_parent()) {
            if (current.metaWindow && current.can_focus)
                return current;
        }

        return this._getWorkspaceFocusChain(workspaceActor).find(
            preview => preview === actor || preview.contains(actor)) ?? null;
    }

    _clearFocusedPreview() {
        if (!this._focusedPreviewActor) {
            this._focusedPreviewDestroyId = 0;
            return;
        }

        try {
            if (this._focusedPreviewDestroyId) {
                this._focusedPreviewActor.disconnect(
                    this._focusedPreviewDestroyId);
            }
            this._focusedPreviewActor.remove_style_class_name(
                PREVIEW_FOCUS_CLASS);

            const windowContainer =
                this._focusedPreviewActor.get_first_child?.();
            if (windowContainer?.remove_style_class_name) {
                windowContainer.remove_style_class_name(
                    PREVIEW_FOCUS_WINDOW_CLASS);
            }
        } catch (error) {
            // The preview may already have been destroyed with the window.
        }

        this._focusedPreviewActor = null;
        this._focusedPreviewDestroyId = 0;
    }

    _onFocusedPreviewDestroyed() {
        this._focusedPreviewDestroyId = 0;
        this._focusedPreviewActor = null;
    }

    _focusIsInActiveWorkspace() {
        const activeWorkspace = global.workspace_manager.get_active_workspace();
        const activeWorkspaceActor = this._getWorkspaceActor(activeWorkspace);
        const focusedWorkspaceActor =
            this._findWorkspaceForActor(global.stage.key_focus);
        return activeWorkspaceActor !== null &&
            activeWorkspaceActor === focusedWorkspaceActor;
    }

    _scheduleWorkspaceFocus(delay, direction = null) {
        this._cancelScheduledFocus();
        const generation = this._focusGeneration;

        this._focusTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            delay,
            () => {
                this._focusTimeoutId = 0;
                if (generation === this._focusGeneration) {
                    this._focusActiveWorkspace(direction);
                    this._pendingDirection = null;
                }
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelScheduledFocus() {
        if (!this._focusTimeoutId)
            return;

        GLib.source_remove(this._focusTimeoutId);
        this._focusTimeoutId = 0;
    }

    _moveFocusWithinWorkspace(workspaceActor, keyFocus, direction) {
        const items = this._getPreviewItems(workspaceActor);
        if (items.length === 0)
            return false;

        const currentPreview =
            this._findPreviewInWorkspace(workspaceActor, keyFocus);

        if (!currentPreview) {
            return false;
        }

        const currentItem = items.find(
            item => item.preview === currentPreview);
        if (!currentItem)
            return false;

        const nextItem =
            this._findNextPreviewByPosition(items, currentItem, direction);
        if (!nextItem)
            return false;

        nextItem.preview.grab_key_focus();
        return true;
    }

    _getPreviewItems(workspaceActor) {
        const slots =
            workspaceActor?._container?.layout_manager?._windowSlots ?? [];
        if (slots.length > 0) {
            return slots.map(slot => {
                const [x, y, width, height, preview] = slot;
                return {
                    preview,
                    x,
                    y,
                    width,
                    height,
                    centerX: x + width / 2,
                    centerY: y + height / 2,
                };
            });
        }

        return this._getWorkspaceFocusChain(workspaceActor).map(preview => {
            const {x, y} = this._previewPosition(preview);
            const width = preview.width;
            const height = preview.height;
            return {
                preview,
                x,
                y,
                width,
                height,
                centerX: x + width / 2,
                centerY: y + height / 2,
            };
        });
    }

    _findNextPreviewByPosition(items, currentItem, direction) {
        const horizontal =
            direction === Meta.MotionDirection.LEFT ||
            direction === Meta.MotionDirection.RIGHT;

        const orthogonalWeight = horizontal
            ? ORTHOGONAL_WEIGHT_HORIZONTAL
            : ORTHOGONAL_WEIGHT_VERTICAL;

        let bestItem = null;
        let bestDistance = Infinity;

        for (const item of items) {
            if (item === currentItem)
                continue;

            if (!this._isCandidateInDirection(
                currentItem, item, direction))
                continue;

            const distance = this._spatialDistance(
                currentItem, item, direction, orthogonalWeight);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestItem = item;
            }
        }

        return bestItem;
    }

    _isCandidateInDirection(currentItem, item, direction) {
        switch (direction) {
        case Meta.MotionDirection.LEFT:
            return item.centerX <
                currentItem.centerX - DIRECTION_TOLERANCE;
        case Meta.MotionDirection.RIGHT:
            return item.centerX >
                currentItem.centerX + DIRECTION_TOLERANCE;
        case Meta.MotionDirection.UP:
            return item.centerY <
                currentItem.centerY - DIRECTION_TOLERANCE;
        case Meta.MotionDirection.DOWN:
            return item.centerY >
                currentItem.centerY + DIRECTION_TOLERANCE;
        default:
            return false;
        }
    }

    // Distance function from W3C CSS Spatial Navigation / Chromium Blink:
    // distance = euclidean + navigation_axis_distance
    //          + weighted_orthogonal_axis_distance - sqrt(overlap)
    _spatialDistance(currentItem, item, direction, orthogonalWeight) {
        const euclidean = Math.hypot(
            item.centerX - currentItem.centerX,
            item.centerY - currentItem.centerY);

        const horizontal =
            direction === Meta.MotionDirection.LEFT ||
            direction === Meta.MotionDirection.RIGHT;

        let navigationAxisDistance;
        let orthogonalAxisDistance;

        if (horizontal) {
            if (direction === Meta.MotionDirection.RIGHT) {
                navigationAxisDistance = Math.max(
                    0, item.x - (currentItem.x + currentItem.width));
            } else {
                navigationAxisDistance = Math.max(
                    0, currentItem.x - (item.x + item.width));
            }

            const currentTop = currentItem.y;
            const currentBottom = currentItem.y + currentItem.height;
            const itemTop = item.y;
            const itemBottom = item.y + item.height;
            if (itemBottom < currentTop)
                orthogonalAxisDistance = currentTop - itemBottom;
            else if (itemTop > currentBottom)
                orthogonalAxisDistance = itemTop - currentBottom;
            else
                orthogonalAxisDistance = 0;
        } else {
            if (direction === Meta.MotionDirection.DOWN) {
                navigationAxisDistance = Math.max(
                    0, item.y - (currentItem.y + currentItem.height));
            } else {
                navigationAxisDistance = Math.max(
                    0, currentItem.y - (item.y + item.height));
            }

            const currentLeft = currentItem.x;
            const currentRight = currentItem.x + currentItem.width;
            const itemLeft = item.x;
            const itemRight = item.x + item.width;
            if (itemRight < currentLeft)
                orthogonalAxisDistance = currentLeft - itemRight;
            else if (itemLeft > currentRight)
                orthogonalAxisDistance = itemLeft - currentRight;
            else
                orthogonalAxisDistance = 0;
        }

        const overlapWidth = Math.max(0,
            Math.min(currentItem.x + currentItem.width,
                item.x + item.width) -
            Math.max(currentItem.x, item.x));
        const overlapHeight = Math.max(0,
            Math.min(currentItem.y + currentItem.height,
                item.y + item.height) -
            Math.max(currentItem.y, item.y));
        const overlapArea = overlapWidth * overlapHeight;

        return euclidean +
            navigationAxisDistance +
            orthogonalAxisDistance * orthogonalWeight -
            Math.sqrt(overlapArea);
    }

    _getWorkspaceFocusChain(workspaceActor) {
        return workspaceActor?._container?.layout_manager?.getFocusChain?.()
            ?.filter(actor => actor !== null) ?? [];
    }

    _focusActiveWorkspace(direction = null) {
        if (!Main.overview.visible || !this._isWindowPicker())
            return;

        const activeWorkspace = global.workspace_manager.get_active_workspace();
        const workspaceActor = this._getWorkspaceActor(activeWorkspace);
        if (!workspaceActor)
            return;

        this._clearWorkspaceFocus();

        const items = this._getPreviewItems(workspaceActor);

        if (items.length > 0) {
            const target = direction
                ? this._bestPreviewForDirection(items, direction)
                : this._previewForLastFocusedWindow(items);
            (target ?? items[0]).preview.grab_key_focus();
            return;
        }

        const emptyWorkspaceTarget = new St.Widget({
            can_focus: true,
            reactive: false,
            x_expand: true,
            y_expand: true,
            style_class: EMPTY_WORKSPACE_FOCUS_CLASS,
        });
        workspaceActor.add_child(emptyWorkspaceTarget);
        this._emptyWorkspaceActor = emptyWorkspaceTarget;
        emptyWorkspaceTarget.grab_key_focus();
    }

    _previewForLastFocusedWindow(items) {
        const focusWindow = global.display.focus_window;
        if (!focusWindow)
            return null;

        return items.find(
            item => item.preview.metaWindow === focusWindow) ?? null;
    }

    _bestPreviewForDirection(items, direction) {
        if (!direction)
            return items[0];

        let best = items[0];

        for (const item of items.slice(1)) {
            switch (direction) {
            case Meta.MotionDirection.LEFT:
                if (item.centerX > best.centerX)
                    best = item;
                break;
            case Meta.MotionDirection.RIGHT:
                if (item.centerX < best.centerX)
                    best = item;
                break;
            case Meta.MotionDirection.UP:
                if (item.centerY > best.centerY)
                    best = item;
                break;
            case Meta.MotionDirection.DOWN:
                if (item.centerY < best.centerY)
                    best = item;
                break;
            }
        }

        return best;
    }

    _previewPosition(preview) {
        const [x, y] = preview.get_transformed_position();
        return {x, y};
    }

    _clearEmptyWorkspaceFocus() {
        const target = this._emptyWorkspaceActor;
        this._emptyWorkspaceActor = null;
        if (!target)
            return;

        try {
            target.destroy();
        } catch (error) {
            // The target may already have been destroyed by the shell.
        }
    }

    _clearWorkspaceFocus() {
        this._clearEmptyWorkspaceFocus();
        this._clearFocusedPreview();
    }
}
