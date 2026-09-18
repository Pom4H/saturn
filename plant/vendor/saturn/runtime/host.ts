import { wasmBase64 } from './binary';
import type { FbdWasmModule } from './fbd-runtime';
let compiled: WebAssembly.Module | undefined;
/** Pinned runtime, not uploaded code. The supported scan subset does not use a clock. */
export function createSaturnModule(): FbdWasmModule {
    compiled ??= new WebAssembly.Module(Uint8Array.from(atob(wasmBase64), c => c.charCodeAt(0)));
    const unsupportedClock = () => { throw new Error('RTC functions are outside the deterministic Saturn profile'); };
    const instance = new WebAssembly.Instance(compiled, { a: { a: () => 0, b: unsupportedClock, c: unsupportedClock } });
    const e = instance.exports, memory = e.d as WebAssembly.Memory;
    (e.e as Function)();
    const names = ['clear_draw_buffer','load','memory_size','step','step_ex','set_input','get_output','draw_count','draw_type','draw_x1','draw_y1','draw_x2','draw_y2','draw_color','draw_bkcolor','draw_font','draw_transparent','draw_image','draw_text_ptr','draw_end_seen','sp_count','sp_field','sp_caption','sp_set','wp_count','wp_value','wp_divider','wp_caption','project_field','io_hint'];
    const exports = ['f','g','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z','A','B','C','D','E','F','G','H','I','J','K'];
    const map = Object.fromEntries(names.map((n,i) => ['bridge_'+n, e[exports[i]]]));
    return {
        get HEAPU8() { return new Uint8Array(memory.buffer); },
        _malloc(size) { const ptr = (e.i as Function)(size); if (!ptr) throw new Error('Saturn memory allocation failed'); return ptr; },
        _free(ptr) { (e.h as Function)(ptr); },
        ccall(name, _returnType, _argTypes, args) { const fn=map[name]; if(typeof fn !== 'function') throw new Error('Unsupported Saturn ABI: '+name); return fn(...args); },
    };
}
