/**
 * Extra on-screen key bar.
 *
 * Phone (virtual) keyboards don't have most of the keys that a physical
 * computer keyboard has - Escape, Tab, the F1-F12 row, Ctrl, Alt, and so
 * on. This module renders a scrollable row of those keys underneath the
 * emulated screen, so they can be "pressed" on touch devices (and with a
 * mouse).
 *
 * The buttons never take focus away from the hidden phone_keyboard
 * textarea (the tap's pointerdown event is defaultPrevented), so the
 * virtual keyboard stays open on phones.
 *
 * Ctrl/Alt/Shift/Win behave as one-shot sticky modifiers: tap once to
 * arm (the button lights up), tap again to disarm, or they disarm
 * themselves after the next key is pressed - including the next character
 * typed through the soft keyboard. The dedicated combination buttons
 * (⇧Tab, Alt+Tab, Ctrl+Alt+Del) always send their built-in modifiers;
 * armed sticky modifiers are applied on top of them.
 */

import {
    MODIFIER_DEFS,
    MODIFIER_ORDER,
    subscribe_sticky_modifier_changes,
    toggle_sticky_modifier,
    is_sticky_modifier_armed,
    consume_sticky_modifiers,
    sticky_modifier_release_codes,
} from "./sticky_modifiers.js";

/**
 * @typedef {{
 *     label: (string|undefined),
 *     title: (string|undefined),
 *     mod: (string|undefined),
 *     make: (Array.<number>|undefined),
 *     release: (Array.<number>|undefined),
 *     modifiers: (Array.<string>|undefined),
 *     hold_ms: (number|undefined),
 * }}
 */
var ExtraKeyDef;

// PS/2 Set 1 scancodes, extended keys carry a 0xE0 prefix. Break codes
// are the make codes with the key byte (the last byte) ORed with 0x80.

/** @type {!Array.<!Array.<!ExtraKeyDef>>} */
const LAYOUT = [
    [
        { label: "Esc", title: "Escape", make: [0x01] },
        { label: "Tab", title: "Tab", make: [0x0F] },
        { label: "⇧Tab", title: "Shift+Tab", make: [0x0F], modifiers: ["shift"] },
    ],
    [
        { mod: "ctrl", title: "Ctrl, sticky: applies to the next key" },
        { mod: "alt", title: "Alt, sticky: applies to the next key" },
        { mod: "shift", title: "Shift, sticky: applies to the next key" },
        { mod: "win", title: "Win (Super/Meta), sticky: applies to the next key" },
    ],
    [
        { label: "←", title: "Arrow Left", make: [0xE0, 0x4B] },
        { label: "↑", title: "Arrow Up", make: [0xE0, 0x48] },
        { label: "↓", title: "Arrow Down", make: [0xE0, 0x50] },
        { label: "→", title: "Arrow Right", make: [0xE0, 0x4D] },
    ],
    [
        { label: "Home", title: "Home", make: [0xE0, 0x47] },
        { label: "End", title: "End", make: [0xE0, 0x4F] },
        { label: "PgUp", title: "Page Up", make: [0xE0, 0x49] },
        { label: "PgDn", title: "Page Down", make: [0xE0, 0x51] },
        { label: "Ins", title: "Insert", make: [0xE0, 0x52] },
        { label: "Del", title: "Delete", make: [0xE0, 0x53] },
    ],
    [
        { label: "F1", title: "F1", make: [0x3B] },
        { label: "F2", title: "F2", make: [0x3C] },
        { label: "F3", title: "F3", make: [0x3D] },
        { label: "F4", title: "F4", make: [0x3E] },
        { label: "F5", title: "F5, refresh", make: [0x3F] },
        { label: "F6", title: "F6", make: [0x40] },
        { label: "F7", title: "F7", make: [0x41] },
        { label: "F8", title: "F8", make: [0x42] },
        { label: "F9", title: "F9", make: [0x43] },
        { label: "F10", title: "F10", make: [0x44] },
        { label: "F11", title: "F11", make: [0x57] },
        { label: "F12", title: "F12", make: [0x58] },
    ],
    [
        { label: "Caps", title: "Caps Lock", make: [0x3A] },
        { label: "Num", title: "Num Lock", make: [0x45] },
        { label: "ScrLk", title: "Scroll Lock", make: [0x46] },
        { label: "Menu", title: "Context Menu key", make: [0xE0, 0x5D] },
        { label: "PrtSc", title: "Print Screen", make: [0xE0, 0x2A, 0xE0, 0x37], release: [0xE0, 0xB7, 0xE0, 0xAA] },
    ],
    [
        { label: "Alt+Tab", title: "Alt+Tab, switch windows", make: [0x0F], modifiers: ["alt"], hold_ms: 120 },
        { label: "Ctrl+Alt+Del", title: "Ctrl+Alt+Del", make: [0x53], modifiers: ["ctrl", "alt"] },
    ],
];

/**
 * @param {!Array.<number>} make
 * @param {(Array.<number>|undefined)} release
 * @returns {!Array.<number>}
 */
function release_codes(make, release)
{
    if(release)
    {
        return release.slice();
    }

    return make.map((byte, index) => index === make.length - 1 ? byte | 0x80 : byte);
}

/**
 * Create the extra keys bar inside `container`.
 *
 * @param {!HTMLElement} container - empty element that gets filled with buttons
 * @param {function(!Array.<number>): void} send - send raw scan codes to the emulator
 * @returns {{ destroy: function(): void }}
 */
export function init_extra_keys(container, send)
{
    /** @type {!Object.<string, !HTMLButtonElement>} */
    const modifier_buttons = {};

    /** @type {!Array.<{target: !EventTarget, type: string, listener: !function(!Event): void}>} */
    const listeners = [];

    /**
     * @param {!EventTarget} target
     * @param {string} type
     * @param {!function(!Event): void} listener
     */
    function on(target, type, listener)
    {
        target.addEventListener(type, listener);
        listeners.push({ target, type, listener });
    }

    function refresh_modifier_buttons()
    {
        for(const id of MODIFIER_ORDER)
        {
            const button = modifier_buttons[id];

            if(button)
            {
                const is_armed = is_sticky_modifier_armed(id);
                button.classList.toggle("armed", is_armed);
                button.setAttribute("aria-pressed", is_armed ? "true" : "false");
            }
        }
    }

    const unsubscribe_modifier_changes = subscribe_sticky_modifier_changes(refresh_modifier_buttons);

    /**
     * @param {!HTMLButtonElement} button
     */
    function flash(button)
    {
        button.classList.add("pressed");
        setTimeout(function() { button.classList.remove("pressed"); }, 150);
    }

    /**
     * @param {!ExtraKeyDef} def
     */
    function send_key(def)
    {
        const key_make = def.make;

        if(!key_make)
        {
            return;
        }

        // armed sticky modifiers are consumed by every activation
        // (one-shot); dedicated combo buttons (⇧Tab, Alt+Tab, Ctrl+Alt+Del)
        // additionally apply their built-in modifiers
        const consumed = consume_sticky_modifiers();
        const dedicated = def.modifiers || [];

        const modifiers = MODIFIER_ORDER.filter(id =>
            dedicated.indexOf(id) >= 0 || consumed.indexOf(id) >= 0);

        /** @type {!Array.<number>} */
        const make_codes = [];

        for(const id of modifiers)
        {
            make_codes.push(...MODIFIER_DEFS[id].make);
        }

        make_codes.push(...key_make);
        send(make_codes);

        const key_release = release_codes(key_make, def.release);
        const modifiers_reversed = modifiers.slice().reverse();

        const send_release = () =>
        {
            send(key_release);

            for(const id of modifiers_reversed)
            {
                send(sticky_modifier_release_codes(MODIFIER_DEFS[id].make));
            }
        };

        if(def.hold_ms)
        {
            // hold the key for a moment, e.g. so the guest window manager
            // has time to show the Alt+Tab switcher
            setTimeout(send_release, def.hold_ms);
        }
        else
        {
            send_release();
        }
    }

    /**
     * @param {!HTMLButtonElement} button
     * @param {function(): void} action
     */
    function wire_button(button, action)
    {
        let pointer_used = false;

        // activate on pointerdown instead of click, so key presses feel
        // instant; the click handler is kept as a fallback for keyboards
        // (Enter/Space) - it fires right after the pointerdown on the same
        // button, so it is swallowed there to avoid double-firing
        on(button, "pointerdown", function(e)
        {
            pointer_used = true;
            action();
            e.preventDefault();
        });

        on(button, "click", function()
        {
            if(pointer_used)
            {
                pointer_used = false;
                return;
            }

            action();
        });
    }

    function create_separator()
    {
        const separator = document.createElement("span");
        separator.className = "extra_keys_separator";
        separator.setAttribute("aria-hidden", "true");
        container.appendChild(separator);
    }

    // never move focus away from the hidden phone_keyboard textarea, so a
    // phone's virtual keyboard stays open while these buttons are pressed;
    // taps are otherwise handled like taps on the screen (they bubble up to
    // #screen_container's click handler, which re-focuses the phone
    // keyboard), only the mouse pointer lock is skipped there for presses
    // originating in this bar
    on(container, "pointerdown", function(e) { e.preventDefault(); });
    on(container, "mousedown", function(e) { e.preventDefault(); });
    on(container, "contextmenu", function(e) { e.preventDefault(); });

    let group_index = 0;

    for(const group of LAYOUT)
    {
        if(group_index++ > 0)
        {
            create_separator();
        }

        for(const def of group)
        {
            const label = def.label || (def.mod ? MODIFIER_DEFS[def.mod].label : "");
            const title = def.title || label;

            const button = /** @type {!HTMLButtonElement} */ (document.createElement("button"));
            button.type = "button";
            button.title = title;
            button.textContent = label;
            button.setAttribute("aria-label", title);

            if(def.mod)
            {
                const id = def.mod;
                button.className = "extra_keys_modifier";
                button.setAttribute("aria-pressed", "false");

                wire_button(button, function()
                {
                    toggle_sticky_modifier(id);
                    flash(button);
                });

                modifier_buttons[id] = button;
            }
            else
            {
                button.className = "extra_keys_key";

                wire_button(button, function()
                {
                    send_key(def);
                    flash(button);
                });
            }

            container.appendChild(button);
        }
    }

    refresh_modifier_buttons();

    return {
        destroy: function()
        {
            unsubscribe_modifier_changes();

            for(const entry of listeners)
            {
                entry.target.removeEventListener(entry.type, entry.listener);
            }

            listeners.length = 0;
            container.textContent = "";
        },
    };
}
