/**
 * Shared one-shot "sticky" modifiers for the on-screen extra keys bar and
 * the soft-keyboard input path.
 *
 * Phone on-screen keyboards have no Ctrl/Alt/Shift/Win keys, so pressing
 * one of these modifiers in the extra keys bar "arms" it: the modifier is
 * applied to the next key (a button in the bar, or the next character
 * typed through the soft keyboard) and then disarms itself. Tapping the
 * modifier again disarms it manually.
 *
 * The armed state is shared between modules through this singleton.
 * Subscribers are notified synchronously whenever the state changes, so
 * the extra keys bar can re-render its modifier buttons.
 */

/** @type {!Object.<string, {label: string, make: !Array.<number>}>} */
export const MODIFIER_DEFS = {
    ctrl: { label: "Ctrl", make: [0x1D] },
    alt: { label: "Alt", make: [0x38] },
    shift: { label: "Shift", make: [0x2A] },
    win: { label: "Win", make: [0xE0, 0x5B] },
    altgr: { label: "AltGr", make: [0xE0, 0x38] },
};

// Press order when several modifiers are combined; release happens in
// reverse order
export const MODIFIER_ORDER = ["ctrl", "alt", "shift", "win", "altgr"];

/** @type {!Object.<string, boolean>} */
const armed = {
    ctrl: false,
    alt: false,
    shift: false,
    win: false,
    altgr: false,
};

/** @type {!Array.<function(): void>} */
const listeners = [];

/**
 * @param {function(): void} fn
 * @returns {function(): void} unsubscribe function
 */
export function subscribe_sticky_modifier_changes(fn)
{
    listeners.push(fn);

    return function()
    {
        const index = listeners.indexOf(fn);

        if(index >= 0)
        {
            listeners.splice(index, 1);
        }
    };
}

function notify()
{
    for(const fn of listeners.slice())
    {
        fn();
    }
}

/**
 * @param {string} id
 * @returns {boolean} the new armed state
 */
export function toggle_sticky_modifier(id)
{
    if(!(id in MODIFIER_DEFS))
    {
        return false;
    }

    armed[id] = !armed[id];
    notify();
    return armed[id];
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function is_sticky_modifier_armed(id)
{
    return !!armed[id];
}

/**
 * Read the armed modifiers and disarm them (one-shot). Returns the
 * modifier ids in MODIFIER_ORDER.
 *
 * @returns {!Array.<string>}
 */
export function consume_sticky_modifiers()
{
    const ids = MODIFIER_ORDER.filter(id => armed[id]);

    if(ids.length > 0)
    {
        for(const id of ids)
        {
            armed[id] = false;
        }

        notify();
    }

    return ids;
}

/**
 * Release codes for the given make codes: everything except a leading
 * 0xE0 prefix stays as is, the key byte (the last byte) is ORed with 0x80.
 *
 * @param {!Array.<number>} make
 * @returns {!Array.<number>}
 */
export function sticky_modifier_release_codes(make)
{
    return make.map((byte, index) => index === make.length - 1 ? byte | 0x80 : byte);
}
