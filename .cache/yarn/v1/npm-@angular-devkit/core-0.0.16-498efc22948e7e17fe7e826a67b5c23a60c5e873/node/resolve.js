"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const core_1 = require("@angular-devkit/core");
const fs = require("fs");
const path = require("path");
const fs_1 = require("./fs");
/**
 * Exception thrown when a module could not be resolved.
 */
class ModuleNotFoundException extends core_1.BaseException {
    constructor(moduleName, basePath) {
        super(`Could not find module ${JSON.stringify(moduleName)} from ${JSON.stringify(basePath)}.`);
        this.moduleName = moduleName;
        this.basePath = basePath;
        this.code = 'MODULE_NOT_FOUND';
    }
}
exports.ModuleNotFoundException = ModuleNotFoundException;
/**
 * Returns a list of all the callers from the resolve() call.
 * @returns {string[]}
 * @private
 */
function _caller() {
    // see https://code.google.com/p/v8/wiki/JavaScriptStackTraceApi
    const error = Error;
    const origPrepareStackTrace = error.prepareStackTrace;
    error.prepareStackTrace = (_, stack) => stack;
    const stack = (new Error()).stack;
    error.prepareStackTrace = origPrepareStackTrace;
    return stack ? stack.map(x => x.getFileName()) : [];
}
/**
 * Get the global directory for node_modules. This is based on NPM code itself, and may be subject
 * to change, but is relatively stable.
 * @returns {string} The path to node_modules itself.
 * @private
 */
function _getGlobalNodeModules() {
    let globalPrefix;
    if (process.env.PREFIX) {
        globalPrefix = process.env.PREFIX;
    }
    else if (process.platform === 'win32') {
        // c:\node\node.exe --> prefix=c:\node\
        globalPrefix = path.dirname(process.execPath);
    }
    else {
        // /usr/local/bin/node --> prefix=/usr/local
        globalPrefix = path.dirname(path.dirname(process.execPath));
        // destdir only is respected on Unix
        if (process.env.DESTDIR) {
            globalPrefix = path.join(process.env.DESTDIR, globalPrefix);
        }
    }
    return (process.platform !== 'win32')
        ? path.resolve(globalPrefix, 'lib', 'node_modules')
        : path.resolve(globalPrefix, 'node_modules');
}
/**
 * Resolve a package using a logic similar to npm require.resolve, but with more options.
 * @param x The package name to resolve.
 * @param options A list of options. See documentation of those options.
 * @returns {string} Path to the index to include, or if `resolvePackageJson` option was
 *                   passed, a path to that file.
 * @throws {ModuleNotFoundException} If no module with that name was found anywhere.
 */
function resolve(x, options) {
    const readFileSync = fs.readFileSync;
    const extensions = options.extensions || Object.keys(require.extensions);
    const basePath = options.basedir;
    options.paths = options.paths || [];
    if (/^(?:\.\.?(?:\/|$)|\/|([A-Za-z]:)?[/\\])/.test(x)) {
        let res = path.resolve(basePath, x);
        if (x === '..' || x.slice(-1) === '/') {
            res += '/';
        }
        const m = loadAsFileSync(res) || loadAsDirectorySync(res);
        if (m) {
            return m;
        }
    }
    else {
        const n = loadNodeModulesSync(x, basePath);
        if (n) {
            return n;
        }
    }
    // Fallback to checking the local (callee) node modules.
    if (options.checkLocal) {
        const callers = _caller();
        for (const caller of callers) {
            const localDir = path.dirname(caller);
            if (localDir !== options.basedir) {
                try {
                    return resolve(x, Object.assign({}, options, { checkLocal: false, checkGlobal: false, basedir: localDir }));
                }
                catch (e) {
                    // Just swap the basePath with the original call one.
                    if (!(e instanceof ModuleNotFoundException)) {
                        throw e;
                    }
                }
            }
        }
    }
    // Fallback to checking the global node modules.
    if (options.checkGlobal) {
        const globalDir = path.dirname(_getGlobalNodeModules());
        if (globalDir !== options.basedir) {
            try {
                return resolve(x, Object.assign({}, options, { checkLocal: false, checkGlobal: false, basedir: globalDir }));
            }
            catch (e) {
                // Just swap the basePath with the original call one.
                if (!(e instanceof ModuleNotFoundException)) {
                    throw e;
                }
            }
        }
    }
    throw new ModuleNotFoundException(x, basePath);
    function loadAsFileSync(x) {
        if (fs_1.isFile(x)) {
            return x;
        }
        return extensions.map(ex => x + ex).find(f => fs_1.isFile(f)) || null;
    }
    function loadAsDirectorySync(x) {
        const pkgfile = path.join(x, 'package.json');
        if (fs_1.isFile(pkgfile)) {
            if (options.resolvePackageJson) {
                return pkgfile;
            }
            try {
                const body = readFileSync(pkgfile, 'UTF8');
                const pkg = JSON.parse(body);
                if (pkg['main']) {
                    if (pkg['main'] === '.' || pkg['main'] === './') {
                        pkg['main'] = 'index';
                    }
                    const m = loadAsFileSync(path.resolve(x, pkg['main']));
                    if (m) {
                        return m;
                    }
                    const n = loadAsDirectorySync(path.resolve(x, pkg['main']));
                    if (n) {
                        return n;
                    }
                }
            }
            catch (e) { }
        }
        return loadAsFileSync(path.join(x, '/index'));
    }
    function loadNodeModulesSync(x, start) {
        const dirs = nodeModulesPaths(start, options);
        for (const dir of dirs) {
            const m = loadAsFileSync(path.join(dir, '/', x));
            if (m) {
                return m;
            }
            const n = loadAsDirectorySync(path.join(dir, '/', x));
            if (n) {
                return n;
            }
        }
        return null;
    }
    function nodeModulesPaths(start, opts) {
        const modules = ['node_modules'];
        // ensure that `start` is an absolute path at this point,
        // resolving against the process' current working directory
        let absoluteStart = path.resolve(start);
        if (opts && opts.preserveSymlinks === false) {
            try {
                absoluteStart = fs.realpathSync(absoluteStart);
            }
            catch (err) {
                if (err.code !== 'ENOENT') {
                    throw err;
                }
            }
        }
        let prefix = '/';
        if (/^([A-Za-z]:)/.test(absoluteStart)) {
            prefix = '';
        }
        else if (/^\\\\/.test(absoluteStart)) {
            prefix = '\\\\';
        }
        const paths = [absoluteStart];
        let parsed = path.parse(absoluteStart);
        while (parsed.dir !== paths[paths.length - 1]) {
            paths.push(parsed.dir);
            parsed = path.parse(parsed.dir);
        }
        const dirs = paths.reduce((dirs, aPath) => {
            return dirs.concat(modules.map(function (moduleDir) {
                return path.join(prefix, aPath, moduleDir);
            }));
        }, []);
        return opts && opts.paths ? dirs.concat(opts.paths) : dirs;
    }
}
exports.resolve = resolve;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzb2x2ZS5qcyIsInNvdXJjZVJvb3QiOiIvVXNlcnMvaGFuc2wvU291cmNlcy9kZXZraXQvIiwic291cmNlcyI6WyJwYWNrYWdlcy9hbmd1bGFyX2RldmtpdC9jb3JlL25vZGUvcmVzb2x2ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILCtDQUFxRDtBQUNyRCx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLDZCQUE4QjtBQUU5Qjs7R0FFRztBQUNILDZCQUFxQyxTQUFRLG9CQUFhO0lBR3hELFlBQTRCLFVBQWtCLEVBQWtCLFFBQWdCO1FBQzlFLEtBQUssQ0FBQyx5QkFBeUIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsU0FBUyxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQURyRSxlQUFVLEdBQVYsVUFBVSxDQUFRO1FBQWtCLGFBQVEsR0FBUixRQUFRLENBQVE7UUFFOUUsSUFBSSxDQUFDLElBQUksR0FBRyxrQkFBa0IsQ0FBQztJQUNqQyxDQUFDO0NBQ0Y7QUFQRCwwREFPQztBQUVEOzs7O0dBSUc7QUFDSDtJQUNFLGdFQUFnRTtJQUNoRSxNQUFNLEtBQUssR0FBRyxLQUE4RCxDQUFDO0lBQzdFLE1BQU0scUJBQXFCLEdBQUcsS0FBSyxDQUFDLGlCQUFpQixDQUFDO0lBQ3RELEtBQUssQ0FBQyxpQkFBaUIsR0FBRyxDQUFDLENBQUMsRUFBRSxLQUFLLEtBQUssS0FBSyxDQUFDO0lBQzlDLE1BQU0sS0FBSyxHQUFHLENBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBQyxDQUFDLEtBQW9FLENBQUM7SUFDakcsS0FBSyxDQUFDLGlCQUFpQixHQUFHLHFCQUFxQixDQUFDO0lBRWhELE1BQU0sQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBQ3RELENBQUM7QUFHRDs7Ozs7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QyxDQUFDO1FBQzlCLElBQUksTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUM7UUFDdkMsT0FBTyxNQUFNLENBQUMsR0FBRyxLQUFLLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDOUMsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDdkIsTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2xDLENBQUM7UUFFRCxNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsSUFBYyxFQUFFLEtBQWE7WUFDdEQsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLFNBQVM7Z0JBQ2hELE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsU0FBUyxDQUFDLENBQUM7WUFDN0MsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNOLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVQLE1BQU0sQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxJQUFJLENBQUM7SUFDN0QsQ0FBQztBQUNILENBQUM7QUFwS0QsMEJBb0tDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuaW1wb3J0IHsgQmFzZUV4Y2VwdGlvbiB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBpc0ZpbGUgfSBmcm9tICcuL2ZzJztcblxuLyoqXG4gKiBFeGNlcHRpb24gdGhyb3duIHdoZW4gYSBtb2R1bGUgY291bGQgbm90IGJlIHJlc29sdmVkLlxuICovXG5leHBvcnQgY2xhc3MgTW9kdWxlTm90Rm91bmRFeGNlcHRpb24gZXh0ZW5kcyBCYXNlRXhjZXB0aW9uIHtcbiAgcHVibGljIHJlYWRvbmx5IGNvZGU6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihwdWJsaWMgcmVhZG9ubHkgbW9kdWxlTmFtZTogc3RyaW5nLCBwdWJsaWMgcmVhZG9ubHkgYmFzZVBhdGg6IHN0cmluZykge1xuICAgIHN1cGVyKGBDb3VsZCBub3QgZmluZCBtb2R1bGUgJHtKU09OLnN0cmluZ2lmeShtb2R1bGVOYW1lKX0gZnJvbSAke0pTT04uc3RyaW5naWZ5KGJhc2VQYXRoKX0uYCk7XG4gICAgdGhpcy5jb2RlID0gJ01PRFVMRV9OT1RfRk9VTkQnO1xuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyBhIGxpc3Qgb2YgYWxsIHRoZSBjYWxsZXJzIGZyb20gdGhlIHJlc29sdmUoKSBjYWxsLlxuICogQHJldHVybnMge3N0cmluZ1tdfVxuICogQHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gX2NhbGxlcigpOiBzdHJpbmdbXSB7XG4gIC8vIHNlZSBodHRwczovL2NvZGUuZ29vZ2xlLmNvbS9wL3Y4L3dpa2kvSmF2YVNjcmlwdFN0YWNrVHJhY2VBcGlcbiAgY29uc3QgZXJyb3IgPSBFcnJvciBhcyB7fSBhcyB7IHByZXBhcmVTdGFja1RyYWNlOiAoeDoge30sIHN0YWNrOiB7fSkgPT4ge30gfTtcbiAgY29uc3Qgb3JpZ1ByZXBhcmVTdGFja1RyYWNlID0gZXJyb3IucHJlcGFyZVN0YWNrVHJhY2U7XG4gIGVycm9yLnByZXBhcmVTdGFja1RyYWNlID0gKF8sIHN0YWNrKSA9PiBzdGFjaztcbiAgY29uc3Qgc3RhY2sgPSAobmV3IEVycm9yKCkpLnN0YWNrIGFzIHt9W10gfCB1bmRlZmluZWQgYXMgeyBnZXRGaWxlTmFtZSgpOiBzdHJpbmcgfVtdIHwgdW5kZWZpbmVkO1xuICBlcnJvci5wcmVwYXJlU3RhY2tUcmFjZSA9IG9yaWdQcmVwYXJlU3RhY2tUcmFjZTtcblxuICByZXR1cm4gc3RhY2sgPyBzdGFjay5tYXAoeCA9PiB4LmdldEZpbGVOYW1lKCkpIDogW107XG59XG5cblxuLyoqXG4gKiBHZXQgdGhlIGdsb2JhbCBkaXJlY3RvcnkgZm9yIG5vZGVfbW9kdWxlcy4gVGhpcyBpcyBiYXNlZCBvbiBOUE0gY29kZSBpdHNlbGYsIGFuZCBtYXkgYmUgc3ViamVjdFxuICogdG8gY2hhbmdlLCBidXQgaXMgcmVsYXRpdmVseSBzdGFibGUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgcGF0aCB0byBub2RlX21vZHVsZXMgaXRzZWxmLlxuICogQHByaXZhdGVcbiAqL1xuZnVuY3Rpb24gX2dldEdsb2JhbE5vZGVNb2R1bGVzKCkge1xuICBsZXQgZ2xvYmFsUHJlZml4O1xuXG4gIGlmIChwcm9jZXNzLmVudi5QUkVGSVgpIHtcbiAgICBnbG9iYWxQcmVmaXggPSBwcm9jZXNzLmVudi5QUkVGSVg7XG4gIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuICAgIC8vIGM6XFxub2RlXFxub2RlLmV4ZSAtLT4gcHJlZml4PWM6XFxub2RlXFxcbiAgICBnbG9iYWxQcmVmaXggPSBwYXRoLmRpcm5hbWUocHJvY2Vzcy5leGVjUGF0aCk7XG4gIH0gZWxzZSB7XG4gICAgLy8gL3Vzci9sb2NhbC9iaW4vbm9kZSAtLT4gcHJlZml4PS91c3IvbG9jYWxcbiAgICBnbG9iYWxQcmVmaXggPSBwYXRoLmRpcm5hbWUocGF0aC5kaXJuYW1lKHByb2Nlc3MuZXhlY1BhdGgpKTtcblxuICAgIC8vIGRlc3RkaXIgb25seSBpcyByZXNwZWN0ZWQgb24gVW5peFxuICAgIGlmIChwcm9jZXNzLmVudi5ERVNURElSKSB7XG4gICAgICBnbG9iYWxQcmVmaXggPSBwYXRoLmpvaW4ocHJvY2Vzcy5lbnYuREVTVERJUiwgZ2xvYmFsUHJlZml4KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gKHByb2Nlc3MucGxhdGZvcm0gIT09ICd3aW4zMicpXG4gICAgPyBwYXRoLnJlc29sdmUoZ2xvYmFsUHJlZml4LCAnbGliJywgJ25vZGVfbW9kdWxlcycpXG4gICAgOiBwYXRoLnJlc29sdmUoZ2xvYmFsUHJlZml4LCAnbm9kZV9tb2R1bGVzJyk7XG59XG5cblxuZXhwb3J0IGludGVyZmFjZSBSZXNvbHZlT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBUaGUgYmFzZWRpciB0byB1c2UgZnJvbSB3aGljaCB0byByZXNvbHZlLlxuICAgKi9cbiAgYmFzZWRpcjogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgbGlzdCBvZiBleHRlbnNpb25zIHRvIHJlc29sdmUuIEJ5IGRlZmF1bHQgdXNlcyBPYmplY3Qua2V5cyhyZXF1aXJlLmV4dGVuc2lvbnMpLlxuICAgKi9cbiAgZXh0ZW5zaW9ucz86IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBBbiBhZGRpdGlvbmFsIGxpc3Qgb2YgcGF0aHMgdG8gbG9vayBpbnRvLlxuICAgKi9cbiAgcGF0aHM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogV2hldGhlciBvciBub3QgdG8gcHJlc2VydmUgc3ltYm9saWMgbGlua3MuIElmIGZhbHNlLCB0aGUgYWN0dWFsIHBhdGhzIHBvaW50ZWQgYnlcbiAgICogdGhlIHN5bWJvbGljIGxpbmtzIHdpbGwgYmUgdXNlZC4gVGhpcyBkZWZhdWx0cyB0byB0cnVlLlxuICAgKi9cbiAgcHJlc2VydmVTeW1saW5rcz86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gZmFsbGJhY2sgdG8gYSBnbG9iYWwgbG9va3VwIGlmIHRoZSBiYXNlZGlyIG9uZSBmYWlsZWQuXG4gICAqL1xuICBjaGVja0dsb2JhbD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gZmFsbGJhY2sgdG8gdXNpbmcgdGhlIGxvY2FsIGNhbGxlcidzIGRpcmVjdG9yeSBpZiB0aGUgYmFzZWRpciBmYWlsZWQuXG4gICAqL1xuICBjaGVja0xvY2FsPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogV2hldGhlciB0byBvbmx5IHJlc29sdmUgYW5kIHJldHVybiB0aGUgZmlyc3QgcGFja2FnZS5qc29uIGZpbGUgZm91bmQuIEJ5IGRlZmF1bHQsXG4gICAqIHJlc29sdmVzIHRoZSBtYWluIGZpZWxkIG9yIHRoZSBpbmRleCBvZiB0aGUgcGFja2FnZS5cbiAgICovXG4gIHJlc29sdmVQYWNrYWdlSnNvbj86IGJvb2xlYW47XG59XG5cbi8qKlxuICogUmVzb2x2ZSBhIHBhY2thZ2UgdXNpbmcgYSBsb2dpYyBzaW1pbGFyIHRvIG5wbSByZXF1aXJlLnJlc29sdmUsIGJ1dCB3aXRoIG1vcmUgb3B0aW9ucy5cbiAqIEBwYXJhbSB4IFRoZSBwYWNrYWdlIG5hbWUgdG8gcmVzb2x2ZS5cbiAqIEBwYXJhbSBvcHRpb25zIEEgbGlzdCBvZiBvcHRpb25zLiBTZWUgZG9jdW1lbnRhdGlvbiBvZiB0aG9zZSBvcHRpb25zLlxuICogQHJldHVybnMge3N0cmluZ30gUGF0aCB0byB0aGUgaW5kZXggdG8gaW5jbHVkZSwgb3IgaWYgYHJlc29sdmVQYWNrYWdlSnNvbmAgb3B0aW9uIHdhc1xuICogICAgICAgICAgICAgICAgICAgcGFzc2VkLCBhIHBhdGggdG8gdGhhdCBmaWxlLlxuICogQHRocm93cyB7TW9kdWxlTm90Rm91bmRFeGNlcHRpb259IElmIG5vIG1vZHVsZSB3aXRoIHRoYXQgbmFtZSB3YXMgZm91bmQgYW55d2hlcmUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlKHg6IHN0cmluZywgb3B0aW9uczogUmVzb2x2ZU9wdGlvbnMpOiBzdHJpbmcge1xuICBjb25zdCByZWFkRmlsZVN5bmMgPSBmcy5yZWFkRmlsZVN5bmM7XG5cbiAgY29uc3QgZXh0ZW5zaW9uczogc3RyaW5nW10gPSBvcHRpb25zLmV4dGVuc2lvbnMgfHwgT2JqZWN0LmtleXMocmVxdWlyZS5leHRlbnNpb25zKTtcbiAgY29uc3QgYmFzZVBhdGggPSBvcHRpb25zLmJhc2VkaXI7XG5cbiAgb3B0aW9ucy5wYXRocyA9IG9wdGlvbnMucGF0aHMgfHwgW107XG5cbiAgaWYgKC9eKD86XFwuXFwuPyg/OlxcL3wkKXxcXC98KFtBLVphLXpdOik/Wy9cXFxcXSkvLnRlc3QoeCkpIHtcbiAgICBsZXQgcmVzID0gcGF0aC5yZXNvbHZlKGJhc2VQYXRoLCB4KTtcbiAgICBpZiAoeCA9PT0gJy4uJyB8fCB4LnNsaWNlKC0xKSA9PT0gJy8nKSB7XG4gICAgICByZXMgKz0gJy8nO1xuICAgIH1cblxuICAgIGNvbnN0IG0gPSBsb2FkQXNGaWxlU3luYyhyZXMpIHx8IGxvYWRBc0RpcmVjdG9yeVN5bmMocmVzKTtcbiAgICBpZiAobSkge1xuICAgICAgcmV0dXJuIG07XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGNvbnN0IG4gPSBsb2FkTm9kZU1vZHVsZXNTeW5jKHgsIGJhc2VQYXRoKTtcbiAgICBpZiAobikge1xuICAgICAgcmV0dXJuIG47XG4gICAgfVxuICB9XG5cbiAgLy8gRmFsbGJhY2sgdG8gY2hlY2tpbmcgdGhlIGxvY2FsIChjYWxsZWUpIG5vZGUgbW9kdWxlcy5cbiAgaWYgKG9wdGlvbnMuY2hlY2tMb2NhbCkge1xuICAgIGNvbnN0IGNhbGxlcnMgPSBfY2FsbGVyKCk7XG4gICAgZm9yIChjb25zdCBjYWxsZXIgb2YgY2FsbGVycykge1xuICAgICAgY29uc3QgbG9jYWxEaXIgPSBwYXRoLmRpcm5hbWUoY2FsbGVyKTtcbiAgICAgIGlmIChsb2NhbERpciAhPT0gb3B0aW9ucy5iYXNlZGlyKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIHJlc29sdmUoeCwge1xuICAgICAgICAgICAgLi4ub3B0aW9ucyxcbiAgICAgICAgICAgIGNoZWNrTG9jYWw6IGZhbHNlLFxuICAgICAgICAgICAgY2hlY2tHbG9iYWw6IGZhbHNlLFxuICAgICAgICAgICAgYmFzZWRpcjogbG9jYWxEaXIsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAvLyBKdXN0IHN3YXAgdGhlIGJhc2VQYXRoIHdpdGggdGhlIG9yaWdpbmFsIGNhbGwgb25lLlxuICAgICAgICAgIGlmICghKGUgaW5zdGFuY2VvZiBNb2R1bGVOb3RGb3VuZEV4Y2VwdGlvbikpIHtcbiAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gRmFsbGJhY2sgdG8gY2hlY2tpbmcgdGhlIGdsb2JhbCBub2RlIG1vZHVsZXMuXG4gIGlmIChvcHRpb25zLmNoZWNrR2xvYmFsKSB7XG4gICAgY29uc3QgZ2xvYmFsRGlyID0gcGF0aC5kaXJuYW1lKF9nZXRHbG9iYWxOb2RlTW9kdWxlcygpKTtcbiAgICBpZiAoZ2xvYmFsRGlyICE9PSBvcHRpb25zLmJhc2VkaXIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiByZXNvbHZlKHgsIHtcbiAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICAgIGNoZWNrTG9jYWw6IGZhbHNlLFxuICAgICAgICAgIGNoZWNrR2xvYmFsOiBmYWxzZSxcbiAgICAgICAgICBiYXNlZGlyOiBnbG9iYWxEaXIsXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBKdXN0IHN3YXAgdGhlIGJhc2VQYXRoIHdpdGggdGhlIG9yaWdpbmFsIGNhbGwgb25lLlxuICAgICAgICBpZiAoIShlIGluc3RhbmNlb2YgTW9kdWxlTm90Rm91bmRFeGNlcHRpb24pKSB7XG4gICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHRocm93IG5ldyBNb2R1bGVOb3RGb3VuZEV4Y2VwdGlvbih4LCBiYXNlUGF0aCk7XG5cbiAgZnVuY3Rpb24gbG9hZEFzRmlsZVN5bmMoeDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgaWYgKGlzRmlsZSh4KSkge1xuICAgICAgcmV0dXJuIHg7XG4gICAgfVxuXG4gICAgcmV0dXJuIGV4dGVuc2lvbnMubWFwKGV4ID0+IHggKyBleCkuZmluZChmID0+IGlzRmlsZShmKSkgfHwgbnVsbDtcbiAgfVxuXG4gIGZ1bmN0aW9uIGxvYWRBc0RpcmVjdG9yeVN5bmMoeDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgcGtnZmlsZSA9IHBhdGguam9pbih4LCAncGFja2FnZS5qc29uJyk7XG4gICAgaWYgKGlzRmlsZShwa2dmaWxlKSkge1xuICAgICAgaWYgKG9wdGlvbnMucmVzb2x2ZVBhY2thZ2VKc29uKSB7XG4gICAgICAgIHJldHVybiBwa2dmaWxlO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBib2R5ID0gcmVhZEZpbGVTeW5jKHBrZ2ZpbGUsICdVVEY4Jyk7XG4gICAgICAgIGNvbnN0IHBrZyA9IEpTT04ucGFyc2UoYm9keSk7XG5cbiAgICAgICAgaWYgKHBrZ1snbWFpbiddKSB7XG4gICAgICAgICAgaWYgKHBrZ1snbWFpbiddID09PSAnLicgfHwgcGtnWydtYWluJ10gPT09ICcuLycpIHtcbiAgICAgICAgICAgIHBrZ1snbWFpbiddID0gJ2luZGV4JztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBtID0gbG9hZEFzRmlsZVN5bmMocGF0aC5yZXNvbHZlKHgsIHBrZ1snbWFpbiddKSk7XG4gICAgICAgICAgaWYgKG0pIHtcbiAgICAgICAgICAgIHJldHVybiBtO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBuID0gbG9hZEFzRGlyZWN0b3J5U3luYyhwYXRoLnJlc29sdmUoeCwgcGtnWydtYWluJ10pKTtcbiAgICAgICAgICBpZiAobikge1xuICAgICAgICAgICAgcmV0dXJuIG47XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlKSB7fVxuICAgIH1cblxuICAgIHJldHVybiBsb2FkQXNGaWxlU3luYyhwYXRoLmpvaW4oeCwgJy9pbmRleCcpKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGxvYWROb2RlTW9kdWxlc1N5bmMoeDogc3RyaW5nLCBzdGFydDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgZGlycyA9IG5vZGVNb2R1bGVzUGF0aHMoc3RhcnQsIG9wdGlvbnMpO1xuICAgIGZvciAoY29uc3QgZGlyIG9mIGRpcnMpIHtcbiAgICAgIGNvbnN0IG0gPSBsb2FkQXNGaWxlU3luYyhwYXRoLmpvaW4oZGlyLCAnLycsIHgpKTtcbiAgICAgIGlmIChtKSB7XG4gICAgICAgIHJldHVybiBtO1xuICAgICAgfVxuICAgICAgY29uc3QgbiA9IGxvYWRBc0RpcmVjdG9yeVN5bmMocGF0aC5qb2luKGRpciwgJy8nLCB4KSk7XG4gICAgICBpZiAobikge1xuICAgICAgICByZXR1cm4gbjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGZ1bmN0aW9uIG5vZGVNb2R1bGVzUGF0aHMoc3RhcnQ6IHN0cmluZywgb3B0czogUmVzb2x2ZU9wdGlvbnMpIHtcbiAgICBjb25zdCBtb2R1bGVzID0gWydub2RlX21vZHVsZXMnXTtcblxuICAgIC8vIGVuc3VyZSB0aGF0IGBzdGFydGAgaXMgYW4gYWJzb2x1dGUgcGF0aCBhdCB0aGlzIHBvaW50LFxuICAgIC8vIHJlc29sdmluZyBhZ2FpbnN0IHRoZSBwcm9jZXNzJyBjdXJyZW50IHdvcmtpbmcgZGlyZWN0b3J5XG4gICAgbGV0IGFic29sdXRlU3RhcnQgPSBwYXRoLnJlc29sdmUoc3RhcnQpO1xuXG4gICAgaWYgKG9wdHMgJiYgb3B0cy5wcmVzZXJ2ZVN5bWxpbmtzID09PSBmYWxzZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYWJzb2x1dGVTdGFydCA9IGZzLnJlYWxwYXRoU3luYyhhYnNvbHV0ZVN0YXJ0KTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBpZiAoZXJyLmNvZGUgIT09ICdFTk9FTlQnKSB7XG4gICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IHByZWZpeCA9ICcvJztcbiAgICBpZiAoL14oW0EtWmEtel06KS8udGVzdChhYnNvbHV0ZVN0YXJ0KSkge1xuICAgICAgcHJlZml4ID0gJyc7XG4gICAgfSBlbHNlIGlmICgvXlxcXFxcXFxcLy50ZXN0KGFic29sdXRlU3RhcnQpKSB7XG4gICAgICBwcmVmaXggPSAnXFxcXFxcXFwnO1xuICAgIH1cblxuICAgIGNvbnN0IHBhdGhzID0gW2Fic29sdXRlU3RhcnRdO1xuICAgIGxldCBwYXJzZWQgPSBwYXRoLnBhcnNlKGFic29sdXRlU3RhcnQpO1xuICAgIHdoaWxlIChwYXJzZWQuZGlyICE9PSBwYXRoc1twYXRocy5sZW5ndGggLSAxXSkge1xuICAgICAgcGF0aHMucHVzaChwYXJzZWQuZGlyKTtcbiAgICAgIHBhcnNlZCA9IHBhdGgucGFyc2UocGFyc2VkLmRpcik7XG4gICAgfVxuXG4gICAgY29uc3QgZGlycyA9IHBhdGhzLnJlZHVjZSgoZGlyczogc3RyaW5nW10sIGFQYXRoOiBzdHJpbmcpID0+IHtcbiAgICAgIHJldHVybiBkaXJzLmNvbmNhdChtb2R1bGVzLm1hcChmdW5jdGlvbiAobW9kdWxlRGlyKSB7XG4gICAgICAgIHJldHVybiBwYXRoLmpvaW4ocHJlZml4LCBhUGF0aCwgbW9kdWxlRGlyKTtcbiAgICAgIH0pKTtcbiAgICB9LCBbXSk7XG5cbiAgICByZXR1cm4gb3B0cyAmJiBvcHRzLnBhdGhzID8gZGlycy5jb25jYXQob3B0cy5wYXRocykgOiBkaXJzO1xuICB9XG59XG4iXX0=